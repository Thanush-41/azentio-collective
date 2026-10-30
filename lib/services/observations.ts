import { and, desc, eq, inArray, or } from "drizzle-orm";
import { bookmarks, comments, consents, improvementEvidence, moderationReviews, observations, organizations, publicationReports, publications, themeEvidence, themes } from "@/db/schema";
import { kindOf } from "@/lib/domain/rbac";
import { industryField, offeringField, periodField, regionField } from "@/lib/domain/taxonomy";
import { z } from "zod";
import { scanPrivacy } from "@/lib/domain/privacy";
import { canReadObservation, isModerationEligible } from "@/lib/domain/visibility";
import { assertTransition, OBSERVATION_TRANSITIONS, type ObservationStatus } from "@/lib/domain/workflow";
import { hasSupportGrant } from "./admin";
import { rateLimit } from "./public";
import { ApiError, POLICY_VERSION, type Actor, type Db, type Stmt, auditStmt, notifyStmt, now, requireOrg, requirePermission, runBatch, uid, usersWithRole } from "./core";

export type ObservationInput = {
  offering: string; title: string; industry: string; region: string; observationPeriod: string; evidenceType: string;
  confidence: string; description: string; sharingIntent: "private" | "organization" | "propose_community";
  processingConsent: boolean; allowAttribution: boolean; allowModelTraining: boolean;
};
type Row = typeof observations.$inferSelect;

const consentStmts = (db: Db, id: string, actorId: string, i: Pick<ObservationInput, "sharingIntent" | "processingConsent" | "allowAttribution" | "allowModelTraining">): Stmt[] =>
  ([["processing", i.processingConsent], ["community_sharing", i.sharingIntent === "propose_community"], ["attribution", i.allowAttribution], ["model_training", i.allowModelTraining]] as const)
    .map(([type, granted]) => db.insert(consents).values({ id: uid("CON"), observationId: id, type, state: granted ? "granted" : "revoked", policyVersion: POLICY_VERSION, actorId }));

/** Latest consent state per type for an observation (history is append-only). */
export async function activeConsents(db: Db, observationId: string) {
  const rows = await db.select().from(consents).where(eq(consents.observationId, observationId)).orderBy(consents.createdAt);
  const latest = new Map<string, string>();
  for (const r of rows) latest.set(r.type, r.state);
  return latest;
}

function assertSubmittable(input: Pick<ObservationInput, "sharingIntent" | "processingConsent">) {
  if (input.sharingIntent !== "propose_community") throw new ApiError("Only community-sharing proposals are submitted for moderation; save this as a draft", 400);
  if (!input.processingConsent) throw new ApiError("Processing consent is required before submission", 400);
}

export async function createObservation(db: Db, actor: Actor, input: ObservationInput, submit: boolean) {
  requirePermission(actor, "observation:write");
  const orgId = requireOrg(actor);
  if (submit) assertSubmittable(input);
  const id = uid("OBS"), status: ObservationStatus = submit ? "submitted" : "draft";
  const flags = scanPrivacy(input.title, input.description);
  await runBatch(db, [
    db.insert(observations).values({ id, orgId, authorId: actor.userId, offering: input.offering, title: input.title, industry: input.industry, region: input.region,
      observationPeriod: input.observationPeriod, evidenceType: input.evidenceType, confidence: input.confidence, description: input.description,
      sharingIntent: input.sharingIntent, allowAttribution: input.allowAttribution, allowModelTraining: input.allowModelTraining, privacyFlags: flags.join("; "), status, updatedAt: now() }),
    ...consentStmts(db, id, actor.userId, input),
    notifyStmt(db, actor.userId, status, submit ? `${id} submitted and queued for moderation.` : `${id} saved as a private draft.`),
    auditStmt(db, actor.userId, `create:${status}`, id, input.sharingIntent),
  ]);
  return { observation_id: id, status, moderation_required: submit, community_visible: false, privacy_flags: flags, notification: submit ? "Submission received" : "Private draft saved" };
}

async function loadOwned(db: Db, actor: Actor, id: string) {
  const orgId = requireOrg(actor);
  const [row] = await db.select().from(observations).where(and(eq(observations.id, id), eq(observations.orgId, orgId))).limit(1);
  if (!row || !canReadObservation(actor, row)) throw new ApiError("Observation not found in active workspace", 404);
  return row;
}
function assertAuthor(actor: Actor, row: Row) {
  if (row.authorId !== actor.userId) throw new ApiError("Only the author can edit or submit this observation", 403);
}

export async function updateObservation(db: Db, actor: Actor, id: string, input: ObservationInput, submit: boolean) {
  requirePermission(actor, "observation:write");
  const row = await loadOwned(db, actor, id);
  assertAuthor(actor, row);
  if (!["draft", "clarification_requested", "published"].includes(row.status)) throw new ApiError(`A ${row.status} observation cannot be edited`, 409);
  if (submit) assertSubmittable(input);
  const flags = scanPrivacy(input.title, input.description);
  const stmts: Stmt[] = [];
  let next: ObservationStatus = row.status as ObservationStatus;
  if (row.status === "clarification_requested") { assertTransition(OBSERVATION_TRANSITIONS, "clarification_requested", "draft"); next = "draft"; }
  if (submit) { assertTransition(OBSERVATION_TRANSITIONS, next, "submitted"); next = "submitted"; }
  else if (row.status === "published") throw new ApiError("Material edits to a published contribution must be resubmitted for review", 400);
  if (row.status === "published") {
    // Renewed review: the shared copy stops being retrievable until a moderator approves the new version.
    stmts.push(db.update(publications).set({ status: "pending_review" }).where(eq(publications.sourceId, id)));
  }
  stmts.push(
    db.update(observations).set({ offering: input.offering, title: input.title, industry: input.industry, region: input.region, observationPeriod: input.observationPeriod,
      evidenceType: input.evidenceType, confidence: input.confidence, description: input.description, sharingIntent: input.sharingIntent, allowAttribution: input.allowAttribution,
      allowModelTraining: input.allowModelTraining, privacyFlags: flags.join("; "), status: next, version: row.version + 1, updatedAt: now() }).where(eq(observations.id, id)),
    ...consentStmts(db, id, actor.userId, input),
    notifyStmt(db, actor.userId, next, next === "submitted" ? `${id} resubmitted for moderation.` : `${id} draft updated.`),
    auditStmt(db, actor.userId, `update:${next}`, id, `v${row.version + 1}`),
  );
  await runBatch(db, stmts);
  return { observation_id: id, status: next, version: row.version + 1, privacy_flags: flags };
}

export async function submitObservation(db: Db, actor: Actor, id: string, processingConsent: boolean) {
  requirePermission(actor, "observation:write");
  const row = await loadOwned(db, actor, id);
  assertAuthor(actor, row);
  assertTransition(OBSERVATION_TRANSITIONS, row.status as ObservationStatus, "submitted");
  assertSubmittable({ sharingIntent: row.sharingIntent as ObservationInput["sharingIntent"], processingConsent });
  await runBatch(db, [
    db.update(observations).set({ status: "submitted", updatedAt: now() }).where(eq(observations.id, id)),
    db.insert(consents).values({ id: uid("CON"), observationId: id, type: "processing", state: "granted", policyVersion: POLICY_VERSION, actorId: actor.userId }),
    notifyStmt(db, actor.userId, "submitted", `${id} submitted and queued for moderation.`), auditStmt(db, actor.userId, "submit", id)]);
  return { observation_id: id, status: "submitted" };
}

export async function listObservations(db: Db, actor: Actor) {
  const kind = kindOf(actor.role);
  let rows: Row[] = [];
  if (kind === "client" && actor.orgId) {
    // Private: author only. Organisation/community-intent: any member of the organisation.
    rows = await db.select().from(observations).where(and(eq(observations.orgId, actor.orgId),
      or(eq(observations.sharingIntent, "organization"), eq(observations.sharingIntent, "propose_community"), eq(observations.authorId, actor.userId))!)).orderBy(desc(observations.updatedAt));
  } else if (actor.role === "moderator") {
    rows = (await db.select().from(observations).where(and(eq(observations.status, "submitted"), eq(observations.sharingIntent, "propose_community"))).orderBy(desc(observations.updatedAt)));
  }
  return rows.map(({ orgId: _o, ...r }) => (actor.role === "moderator" ? { ...r, authorId: undefined } : { ...r, orgId: _o }));
}

export async function getObservation(db: Db, actor: Actor, id: string) {
  const [row] = await db.select().from(observations).where(eq(observations.id, id)).limit(1);
  if (!row) throw new ApiError("Observation not found", 404);
  if (!canReadObservation(actor, row)) {
    // Moderators may also read non-private records of an organisation that granted them time-limited support access (audited).
    if (row.sharingIntent !== "private" && await hasSupportGrant(db, actor, row.orgId)) {
      await runBatch(db, [auditStmt(db, actor.userId, "support_read", row.id, row.orgId)]);
      return row;
    }
    throw new ApiError("Observation not found", 404);
  }
  return row;
}

export async function consentHistory(db: Db, actor: Actor, id: string) {
  const row = await getObservation(db, actor, id);
  const rows = await db.select().from(consents).where(eq(consents.observationId, row.id)).orderBy(consents.createdAt);
  // Visible to the owning organisation; moderators see the sharing/processing entries only.
  return rows.filter(r => kindOf(actor.role) === "client" || ["processing", "community_sharing"].includes(r.type)).map(r => ({ id: r.id, type: r.type, state: r.state, policyVersion: r.policyVersion, createdAt: r.createdAt }));
}

export type ModerateInput = { observationId: string; decision: "publish" | "clarify" | "reject"; reason: string; approvedText?: string; themeId?: string; acknowledgeFlags: boolean; attribute?: boolean; metadata?: Partial<{ offering: string; industry: string; region: string; observationPeriod: string }> };
export async function moderate(db: Db, actor: Actor, input: ModerateInput) {
  requirePermission(actor, "moderate");
  const [source] = await db.select().from(observations).where(eq(observations.id, input.observationId)).limit(1);
  if (!source || !isModerationEligible(source)) throw new ApiError("Submitted community proposal not found", 404);
  const author = source.authorId;
  if (input.decision !== "publish") {
    const next: ObservationStatus = input.decision === "clarify" ? "clarification_requested" : "rejected";
    assertTransition(OBSERVATION_TRANSITIONS, "submitted", next);
    await runBatch(db, [
      db.update(observations).set({ status: next, updatedAt: now() }).where(eq(observations.id, source.id)),
      db.insert(moderationReviews).values({ id: uid("REV"), observationId: source.id, moderatorId: actor.userId, decision: next, reason: input.reason }),
      notifyStmt(db, author, next, next === "rejected" ? `${source.id} was not approved for community sharing.` : `${source.id}: a moderator asked for clarification. Edit and resubmit.`),
      auditStmt(db, actor.userId, next, source.id, input.reason)]);
    return { observation_id: source.id, status: next };
  }
  assertTransition(OBSERVATION_TRANSITIONS, "submitted", "published");
  // Publishing re-checks the sharing and processing consent server-side.
  const state = await activeConsents(db, source.id);
  if (state.get("community_sharing") !== "granted" || state.get("processing") !== "granted") throw new ApiError("Valid sharing consent is required to publish", 409);
  if (source.privacyFlags && !input.acknowledgeFlags) throw new ApiError(`Flagged material (${source.privacyFlags}) requires moderator acknowledgement`, 409);
  const approvedText = input.approvedText?.trim();
  if (!approvedText) throw new ApiError("Approved text is required", 400);
  const leaks = scanPrivacy(approvedText);
  if (leaks.length) throw new ApiError(`Approved text still contains restricted material: ${leaks.join(", ")}`, 400);
  if (input.themeId) {
    const [t] = await db.select().from(themes).where(eq(themes.id, input.themeId)).limit(1);
    if (!t) throw new ApiError("Theme not found", 404);
  }
  // Only allow-listed, reviewed values reach the shared copy; the moderator can override each one explicitly.
  const metaSchema = z.object({ offering: offeringField, industry: industryField, region: regionField, observationPeriod: periodField });
  const meta = metaSchema.safeParse({ offering: source.offering, industry: source.industry, region: source.region, observationPeriod: source.observationPeriod, ...(input.metadata ?? {}) });
  if (!meta.success) throw new ApiError(`Shared metadata must use approved values (${meta.error.issues.map(i => i.path.join(".")).join(", ")}); set them explicitly`, 400);
  let attribution: string | null = null;
  if (input.attribute) {
    if (state.get("attribution") !== "granted") throw new ApiError("The contributor has not consented to attribution", 409);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, source.orgId)).limit(1);
    attribution = org?.name ?? null;
  }
  const [existing] = await db.select().from(publications).where(eq(publications.sourceId, source.id)).limit(1);
  const pubId = existing?.id ?? uid("PUB"), version = (existing?.version ?? 0) + 1;
  const pubStmt = existing
    ? db.update(publications).set({ approvedText, ...meta.data, attribution, version, status: "published", publishedAt: now() }).where(eq(publications.id, pubId))
    : db.insert(publications).values({ id: pubId, sourceId: source.id, approvedText, ...meta.data, attribution });
  await runBatch(db, [pubStmt,
    ...(input.themeId ? [db.insert(themeEvidence).values({ themeId: input.themeId, publicationId: pubId }).onConflictDoNothing()] : []),
    db.update(observations).set({ status: "published", updatedAt: now() }).where(eq(observations.id, source.id)),
    db.insert(moderationReviews).values({ id: uid("REV"), observationId: source.id, moderatorId: actor.userId, decision: "publish", reason: input.reason }),
    notifyStmt(db, author, "published", `${source.id} was approved and shared with the community (${pubId}, v${version}).`),
    auditStmt(db, actor.userId, "publish", pubId, input.reason)]);
  return { publication_id: pubId, status: "published", version, visibility: "approved_community" };
}

/** Removes derived artefacts of withdrawn publications (comments, bookmarks) and alerts product owners whose improvements cite them. */
async function propagateWithdrawal(db: Db, publicationIds: string[], actorId: string): Promise<Stmt[]> {
  if (!publicationIds.length) return [];
  const stmts: Stmt[] = [];
  const cited = await db.select({ id: improvementEvidence.improvementId }).from(improvementEvidence).where(inArray(improvementEvidence.publicationId, publicationIds));
  const owners = cited.length ? await usersWithRole(db, ["product_owner"]) : [];
  for (const pid of publicationIds) {
    stmts.push(db.delete(comments).where(eq(comments.publicationId, pid)), db.delete(bookmarks).where(and(eq(bookmarks.kind, "publication"), eq(bookmarks.ref, pid))),
      // Open reports on a withdrawn publication have nothing left to decide.
      db.update(publicationReports).set({ status: "resolved" }).where(and(eq(publicationReports.publicationId, pid), eq(publicationReports.status, "open"))));
  }
  for (const o of owners) stmts.push(notifyStmt(db, o, "evidence_withdrawn", `Evidence cited by ${new Set(cited.map(c => c.id)).size} improvement idea(s) was withdrawn. Review their evidence.`));
  stmts.push(auditStmt(db, actorId, "propagate_withdrawal", publicationIds.join(","), `${cited.length} improvement citation(s)`));
  return stmts;
}

export async function withdraw(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "observation:write");
  const row = await loadOwned(db, actor, id);
  if (row.authorId !== actor.userId && actor.role !== "client_admin") throw new ApiError("Only the author or a client administrator can withdraw", 403);
  assertTransition(OBSERVATION_TRANSITIONS, row.status as ObservationStatus, "withdrawn");
  const pubRows = await db.select({ id: publications.id }).from(publications).where(eq(publications.sourceId, id));
  await runBatch(db, [
    ...await propagateWithdrawal(db, pubRows.map(p => p.id), actor.userId),
    db.update(observations).set({ status: "withdrawn", updatedAt: now() }).where(eq(observations.id, id)),
    db.update(publications).set({ status: "withdrawn" }).where(eq(publications.sourceId, id)),
    db.insert(consents).values({ id: uid("CON"), observationId: id, type: "community_sharing", state: "revoked", policyVersion: POLICY_VERSION, actorId: actor.userId }),
    notifyStmt(db, row.authorId, "withdrawn", `${id} was withdrawn and excluded from future retrieval.`),
    auditStmt(db, actor.userId, "withdraw", id, "Sharing consent revoked; excluded from shared retrieval immediately")]);
  return { observation_id: id, status: "withdrawn", retrieval_excluded: true, effective: "immediate" };
}

/** Distinct reporters with open reports needed before a publication is hidden automatically (a moderator can hold it sooner). */
export const reportAutoHideThreshold = (env: Record<string, string | undefined> = process.env) => Math.max(2, Number(env.REPORT_AUTO_HIDE_REPORTERS) || 2);

/**
 * A single report never unpublishes: it queues the publication for a moderator, who can hold it during review.
 * It is hidden automatically only once reports from several distinct users are open, so one account cannot take the shared feed offline.
 */
export async function reportPublication(db: Db, actor: Actor, publicationId: string, reason: string) {
  requirePermission(actor, "learning:read");
  await rateLimit(db, `report:${actor.userId}`, 20, 3600);
  const [pub] = await db.select().from(publications).where(and(eq(publications.id, publicationId), eq(publications.status, "published"))).limit(1);
  if (!pub) throw new ApiError("Published contribution not found", 404);
  const open = await db.select({ reporterId: publicationReports.reporterId }).from(publicationReports)
    .where(and(eq(publicationReports.publicationId, pub.id), eq(publicationReports.status, "open")));
  if (open.some(r => r.reporterId === actor.userId)) throw new ApiError("You have already reported this contribution; a moderator will review it", 409);
  const reporters = new Set([...open.map(r => r.reporterId), actor.userId]).size;
  const hide = reporters >= reportAutoHideThreshold();
  if (hide) assertTransition(OBSERVATION_TRANSITIONS, "published", "reported");
  const id = uid("RPT");
  const mods = await usersWithRole(db, ["moderator"]);
  await runBatch(db, [
    ...(hide ? [db.update(publications).set({ status: "under_investigation" }).where(eq(publications.id, pub.id)),
      db.update(observations).set({ status: "reported", updatedAt: now() }).where(eq(observations.id, pub.sourceId))] : []),
    db.insert(publicationReports).values({ id, publicationId: pub.id, reporterId: actor.userId, reason }),
    ...mods.map(m => notifyStmt(db, m, "reported", hide ? `${pub.id} was reported by ${reporters} users and temporarily unpublished pending review.`
      : `${pub.id} was reported and is still visible. Review it, and hold it if it should be unpublished during review.`)),
    auditStmt(db, actor.userId, "report", pub.id, `${hide ? "auto-hidden" : "queued"}: ${reason}`)]);
  return { report_id: id, publication_id: pub.id, status: hide ? "under_investigation" : "published", hidden: hide };
}

export async function listReports(db: Db, actor: Actor) {
  requirePermission(actor, "moderate");
  const rows = await db.select({ id: publicationReports.id, publicationId: publicationReports.publicationId, reason: publicationReports.reason, status: publicationReports.status,
    createdAt: publicationReports.createdAt, publicationStatus: publications.status })
    .from(publicationReports).innerJoin(publications, eq(publicationReports.publicationId, publications.id))
    .where(eq(publicationReports.status, "open")).orderBy(desc(publicationReports.createdAt));
  return rows;
}

/**
 * hold     — moderator temporarily unpublishes during review (report stays open).
 * restore  — report dismissed; publication (re)published. Resolves every open report on that publication.
 * withdraw — publication withdrawn after review, with full withdrawal propagation.
 */
export async function resolveReport(db: Db, actor: Actor, reportId: string, outcome: "hold" | "restore" | "withdraw") {
  requirePermission(actor, "moderate");
  const [report] = await db.select().from(publicationReports).where(and(eq(publicationReports.id, reportId), eq(publicationReports.status, "open"))).limit(1);
  if (!report) throw new ApiError("Open report not found", 404);
  const [pub] = await db.select().from(publications).where(eq(publications.id, report.publicationId)).limit(1);
  if (!pub) throw new ApiError("Publication not found", 404);
  const [src] = await db.select().from(observations).where(eq(observations.id, pub.sourceId)).limit(1);
  if (!src) throw new ApiError("Publication source not found", 404);
  const current = src.status as ObservationStatus;

  if (outcome === "hold") {
    assertTransition(OBSERVATION_TRANSITIONS, current, "reported");
    await runBatch(db, [
      db.update(publications).set({ status: "under_investigation" }).where(eq(publications.id, pub.id)),
      db.update(observations).set({ status: "reported", updatedAt: now() }).where(eq(observations.id, src.id)),
      notifyStmt(db, src.authorId, "reported", `${pub.id} was temporarily unpublished while a moderator reviews a report.`),
      auditStmt(db, actor.userId, "report:hold", pub.id)]);
    return { report_id: report.id, status: "reported" as ObservationStatus };
  }

  const next: ObservationStatus = outcome === "restore" ? "published" : "withdrawn";
  // A report dismissed before any hold leaves the publication as it was.
  if (current !== next) assertTransition(OBSERVATION_TRANSITIONS, current, next);
  await runBatch(db, [
    ...(outcome === "withdraw" ? await propagateWithdrawal(db, [pub.id], actor.userId) : []),
    db.update(publications).set({ status: next }).where(eq(publications.id, pub.id)),
    db.update(observations).set({ status: next, updatedAt: now() }).where(eq(observations.id, src.id)),
    db.update(publicationReports).set({ status: "resolved" }).where(and(eq(publicationReports.publicationId, pub.id), eq(publicationReports.status, "open"))),
    ...(current !== next ? [notifyStmt(db, src.authorId, next, outcome === "restore" ? `${pub.id} was reviewed and restored.` : `${pub.id} was withdrawn after review.`)] : []),
    auditStmt(db, actor.userId, `report:${outcome}`, pub.id)]);
  return { report_id: report.id, status: next };
}


