import { and, desc, eq } from "drizzle-orm";
import { consents, contentItems, entitlements, observations, products, publications, themeEvidence, themes } from "@/db/schema";
import { answerQuestion, MIN_ORGANISATIONS, type AiraAnswer, type EvidencePub, type GroundingEvidence } from "@/lib/domain/aira";
import { scanPrivacy } from "@/lib/domain/privacy";
import { kindOf } from "@/lib/domain/rbac";
import { groundedSynthesis } from "./aira-llm";
import { ApiError, POLICY_VERSION, type Actor, type Db, type Stmt, auditStmt, now, requirePermission, runBatch, uid } from "./core";

/** Drops the organisation id so it never reaches a shared payload. */
const strip = <T extends { orgId: string }>({ orgId, ...rest }: T) => (void orgId, rest);

export type Filters = { offering?: string; industry?: string; region?: string; period?: string; topic?: string };

/** Approved, currently-retrievable publications only, with the evidence-to-theme links. Organisation ids never leave this module. */
async function retrieve(db: Db, filters: Filters) {
  const rows = await db.select({ id: publications.id, approvedText: publications.approvedText, offering: publications.offering, industry: publications.industry,
    region: publications.region, observationPeriod: publications.observationPeriod, publishedAt: publications.publishedAt, version: publications.version, attribution: publications.attribution, orgId: observations.orgId })
    .from(publications).innerJoin(observations, eq(publications.sourceId, observations.id))
    .where(and(eq(publications.status, "published"), eq(observations.status, "published"))).orderBy(desc(publications.publishedAt));
  const links = await db.select().from(themeEvidence);
  const themeOf = new Map<string, string[]>();
  for (const l of links) themeOf.set(l.publicationId, [...(themeOf.get(l.publicationId) ?? []), l.themeId]);
  const allThemes = await db.select().from(themes);
  const topicMatch = (pubId: string) => !filters.topic || (themeOf.get(pubId) ?? []).some(tid => {
    const t = allThemes.find(x => x.id === tid);
    return t && `${t.title} ${t.topic}`.toLowerCase().includes(filters.topic!.toLowerCase());
  });
  const pubs = rows.filter(r => (!filters.offering || r.offering === filters.offering) && (!filters.industry || r.industry === filters.industry)
    && (!filters.region || r.region === filters.region) && (!filters.period || r.observationPeriod === filters.period) && topicMatch(r.id));
  return { pubs, themeOf, allThemes };
}

export async function getLearning(db: Db, actor: Actor, filters: Filters = {}) {
  requirePermission(actor, "learning:read");
  const { pubs, themeOf, allThemes } = await retrieve(db, filters);
  let suppressed = 0;
  const visible = allThemes.flatMap(t => {
    const evidence = pubs.filter(p => themeOf.get(p.id)?.includes(t.id));
    if (evidence.length === 0) return [];
    const orgs = new Set(evidence.map(p => p.orgId)).size;
    // The three-organisation threshold is evaluated per theme over the active filter set.
    if (orgs < MIN_ORGANISATIONS) { suppressed++; return []; }
    return [{ id: t.id, title: t.title, offering: t.offering, topic: t.topic, summary: t.summary, supporting_publications: evidence.map(p => p.id), distinct_organizations: orgs,
      confidence: "Limited synthetic sample", warning: "Small sample — directional evidence, not market prevalence.", suggested_improvement: t.suggestedImprovement }];
  });
  // Differencing safeguard: a filtered view that narrows the feed to fewer than three contributing organisations returns no
  // publications, so narrow filter combinations cannot be used to isolate one organisation's contributions. The unfiltered
  // feed lists every approved, individually reviewed shared copy; organisation counts are never returned below the threshold.
  const filtered = Object.values(filters).some(v => typeof v === "string" && v.trim() !== "");
  const publicationsSuppressed = filtered && pubs.length > 0 && new Set(pubs.map(p => p.orgId)).size < MIN_ORGANISATIONS;
  const publicationsOut = publicationsSuppressed ? [] : pubs.map(p => ({ ...strip(p), themeIds: themeOf.get(p.id) ?? [] }));
  return { publications: publicationsOut, publicationsSuppressed, themes: visible, theme: visible[0] ?? null, suppressed: visible.length === 0, suppressedThemes: suppressed,
    distinctOrganizations: visible[0]?.distinct_organizations ?? null, filters };
}

export async function askAira(db: Db, actor: Actor, question: string, filters: Filters) {
  requirePermission(actor, "learning:read");
  const { pubs, themeOf, allThemes } = await retrieve(db, filters);
  const evidence: EvidencePub[] = pubs.flatMap(p => {
    const ids = themeOf.get(p.id) ?? [null];
    return ids.map(themeId => ({ id: p.id, approvedText: p.approvedText, orgId: p.orgId, themeId }));
  });
  const answer = answerQuestion(question, allThemes, evidence);
  const valid = new Set(pubs.map(p => p.id));
  const references = answer.references.filter(r => valid.has(r));
  if (answer.status === "answered" && references.length !== answer.references.length) throw new ApiError("Reference validation failed", 500);
  let result: AiraAnswer = { ...answer, references } as AiraAnswer;
  if (answer.status === "answered") {
    // The threshold and theme scoping above are the authorisation gate; the LLM only rewrites within the already-permitted evidence.
    const grounding: GroundingEvidence[] = pubs.filter(p => references.includes(p.id)).map(p => ({ id: p.id, approvedText: p.approvedText, offering: p.offering,
      industry: p.industry, region: p.region, observationPeriod: p.observationPeriod }));
    const llm = await groundedSynthesis(question, answer.theme.title, grounding);
    result = llm.ok
      ? { ...answer, mode: "llm_grounded", answer: llm.answer, references: llm.citations, limitations: llm.limitations }
      : { ...answer, references, limitations: "Small synthetic sample; directional evidence only.", fallbackReason: llm.reason };
  }
  await runBatch(db, [auditStmt(db, actor.userId, "aira_query", result.status, `[${result.mode}] ${question.slice(0, 110)}`)]);
  const cited: string[] = result.references;
  return { ...result, evidence: pubs.filter(p => cited.includes(p.id)).map(strip) };
}

export async function listEntitlements(db: Db, actor: Actor) {
  if (kindOf(actor.role) !== "client" || !actor.orgId) throw new ApiError("Client membership required", 403);
  return db.select({ id: products.id, name: products.name, code: products.code }).from(entitlements)
    .innerJoin(products, eq(entitlements.productId, products.id)).where(and(eq(entitlements.orgId, actor.orgId), eq(entitlements.status, "enabled")));
}

/** Membership + enabled entitlement are verified on the server for every sandbox run. */
export async function runSandbox(db: Db, actor: Actor, input: { offering: string; cycle: string; seasonality: number }) {
  requirePermission(actor, "sandbox:run");
  if (kindOf(actor.role) === "client") {
    const owned = await listEntitlements(db, actor);
    if (!owned.some(p => p.name === input.offering)) throw new ApiError("Your organisation is not entitled to this product", 403);
  }
  await runBatch(db, [auditStmt(db, actor.userId, "sandbox_run", input.offering, input.cycle)]);
  return { mode: "deterministic_synthetic", offering: input.offering, headline: "Use a like-for-like seasonal view",
    explanation: `${input.cycle} contributes ${input.seasonality}% of annual revenue. A previous-quarter comparison may overstate volatility; explain the result alongside the matching prior-season period.`,
    disclaimer: "Simulated explanation — not a credit recommendation or a commitment by Azentio." };
}

export async function setEntitlement(db: Db, actor: Actor, orgId: string, productId: string, enabled: boolean) {
  requirePermission(actor, "entitlements:manage");
  const id = `ENT-${orgId}-${productId}`;
  await runBatch(db, [db.insert(entitlements).values({ id, orgId, productId, status: enabled ? "enabled" : "disabled" })
    .onConflictDoUpdate({ target: entitlements.id, set: { status: enabled ? "enabled" : "disabled" } }), auditStmt(db, actor.userId, "set_entitlement", id, enabled ? "enabled" : "disabled")]);
  return { id, status: enabled ? "enabled" : "disabled" };
}

/**
 * Moderation-first variant of the judging scenario: three synthetic organisations submit community proposals that land in the
 * moderation queue (nothing is published). One deliberately contains a fake account number and a precise date so the privacy scan
 * fires and the moderator must redact before publishing. Idempotent per organisation while a synthetic proposal is pending.
 */
const MODERATION_SEEDS = [
  ["org-meridian", "Seasonal SME cash flow is often read as volatility",
    "Our relationship managers see seasonal SME borrowers flagged as volatile when festival-quarter revenue is compared with the previous quarter. Example: account 4521 8890 1123 on 14 Aug 2026 was escalated although its seasonal pattern was normal."],
  ["org-northstar", "Agricultural cycles need aligned period comparisons",
    "Agri-linked SME clients show sharp swings between sowing and harvest quarters. Analysts compare against the previous quarter rather than the same season last year, which overstates risk."],
  ["org-harbour", "Seasonal retailers need like-for-like explanations",
    "Seasonal retailers ask why their analysis looks weaker after peak season. A like-for-like seasonal comparison and a plain-language explanation would reduce disputes."],
] as const;

export async function seedModerationScenario(db: Db, actor: Actor) {
  requirePermission(actor, "demo:seed");
  const themeId = "THM-SEASONALITY";
  const stmts: Stmt[] = [db.insert(themes).values({ id: themeId, title: "Seasonality context", topic: "seasonal SME cash-flow analysis", offering: "Financial Analysis Intelligence",
    summary: "Approved contributions describe inconsistent interpretation of seasonal SME cash flows.", suggestedImprovement: "Add a seasonality-aware comparison explanation.", createdBy: "system" }).onConflictDoNothing()];
  const pending = await db.select({ orgId: observations.orgId, authorId: observations.authorId }).from(observations).where(eq(observations.status, "submitted"));
  const created: string[] = [];
  for (const [orgId, title, description] of MODERATION_SEEDS) {
    if (pending.some(p => p.orgId === orgId && p.authorId.startsWith("synthetic-"))) continue;
    const obsId = uid("OBS"), author = `synthetic-${orgId}`;
    created.push(obsId);
    stmts.push(
      db.insert(observations).values({ id: obsId, orgId, authorId: author, offering: "Financial Analysis Intelligence", title, industry: "Banking", region: "India",
        observationPeriod: "2026-Q3", evidenceType: "Synthetic market observation", confidence: "Medium", description, sharingIntent: "propose_community",
        privacyFlags: scanPrivacy(title, description).join("; "), status: "submitted", updatedAt: now() }),
      db.insert(consents).values([{ id: uid("CON"), observationId: obsId, type: "processing", state: "granted", policyVersion: POLICY_VERSION, actorId: author },
        { id: uid("CON"), observationId: obsId, type: "community_sharing", state: "granted", policyVersion: POLICY_VERSION, actorId: author }]));
  }
  stmts.push(auditStmt(db, actor.userId, "seed_moderation_scenario", themeId, `${created.length} synthetic proposals queued for moderation`));
  await runBatch(db, stmts);
  return { status: "queued", created: created.length, observations: created };
}

const SEEDS = [
  ["org-meridian", "Seasonal SME cash flows may require additional context during financial analysis."],
  ["org-northstar", "Agricultural operating cycles may need aligned period comparisons."],
  ["org-harbour", "Like-for-like periods can improve explanations for seasonal retailers."],
] as const;

/**
 * Creates synthetic scenario records. Withdrawn records are never revived: when an organisation has no live
 * synthetic publication, a brand-new synthetic observation (with fresh consent and a fresh publication) is created.
 */
export async function seedScenario(db: Db, actor: Actor) {
  requirePermission(actor, "demo:seed");
  const themeId = "THM-SEASONALITY";
  const stmts: Stmt[] = [db.insert(themes).values({ id: themeId, title: "Seasonality context", topic: "seasonal SME cash-flow analysis", offering: "Financial Analysis Intelligence",
    summary: "Approved contributions describe inconsistent interpretation of seasonal SME cash flows.", suggestedImprovement: "Add a seasonality-aware comparison explanation.", createdBy: "system" }).onConflictDoNothing()];
  const live = await db.select({ orgId: observations.orgId, authorId: observations.authorId }).from(observations).where(eq(observations.status, "published"));
  const created: string[] = [];
  for (const [orgId, text] of SEEDS) {
    if (live.some(l => l.orgId === orgId && l.authorId.startsWith("synthetic-"))) continue;
    const obsId = uid("OBS"), pubId = uid("PUB"), author = `synthetic-${orgId}`;
    created.push(pubId);
    stmts.push(
      db.insert(observations).values({ id: obsId, orgId, authorId: author, offering: "Financial Analysis Intelligence", title: "Seasonal SME cash-flow analysis", industry: "Banking", region: "India",
        observationPeriod: "2026-Q3", evidenceType: "Synthetic market observation", confidence: "Medium", description: text, sharingIntent: "propose_community", status: "published", updatedAt: now() }),
      db.insert(consents).values([{ id: uid("CON"), observationId: obsId, type: "processing", state: "granted", policyVersion: POLICY_VERSION, actorId: author },
        { id: uid("CON"), observationId: obsId, type: "community_sharing", state: "granted", policyVersion: POLICY_VERSION, actorId: author }]),
      db.insert(publications).values({ id: pubId, sourceId: obsId, approvedText: text, offering: "Financial Analysis Intelligence", industry: "Banking", region: "India", observationPeriod: "2026-Q3" }),
      db.insert(themeEvidence).values({ themeId, publicationId: pubId }));
  }
  // Synthetic demonstration content so public, client and employee surfaces are not empty (idempotent by fixed id).
  const demo = (id: string, kind: string, audience: string, title: string, body: string, extra: { owner?: string; reviewDate?: string } = {}) =>
    db.insert(contentItems).values({ id, kind, audience, title, body, status: "published", authorId: "system", owner: extra.owner ?? null, reviewDate: extra.reviewDate ?? null }).onConflictDoNothing();
  stmts.push(
    demo("CNT-DEMO-PUB1", "release_note", "public", "Collective learning hub (synthetic demo)", "Clients can propose observations, moderators publish de-identified copies, and themes appear only when three organisations contribute."),
    demo("CNT-DEMO-PUB2", "knowledge", "public", "How sharing consent works (synthetic demo)", "Private by default. Sharing, attribution and any future training are separate, revocable permissions."),
    demo("CNT-DEMO-EMP1", "knowledge", "employee", "Moderation redaction checklist", "Remove names, accounts and precise dates; reduce geography; confirm the sharing consent is still granted.", { owner: "Learning governance team", reviewDate: "2026-12-01" }),
    demo("CNT-DEMO-EMP2", "knowledge", "employee", "Interpreting small-sample themes", "Three organisations is a floor, not proof of prevalence. Always show the limitation warning.", { owner: "Product insights", reviewDate: "2027-01-15" }),
    demo("CNT-DEMO-EMP3", "broadcast", "employee", "Hackathon demo day (employees only)", "Internal broadcast: demo day schedule and judging notes. Employees only."),
    demo("CNT-DEMO-CLI1", "resource", "client", "Getting started with the sandbox (synthetic demo)", "Open an entitled product from your dashboard, choose an operating cycle and read the simulated explanation."));
  stmts.push(auditStmt(db, actor.userId, "seed_scenario", themeId, `${created.length} new synthetic records`));
  await runBatch(db, stmts);
  return { status: "ready", created: created.length, publications: created };
}
