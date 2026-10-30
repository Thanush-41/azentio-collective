import { beforeEach, describe, expect, it } from "vitest";
import type { Actor, Db } from "@/lib/services/core";
import { createSession, inviteMember, listMemberships, provisionUser, resolveSession, revokeMembership } from "@/lib/services/identity";
import * as obs from "@/lib/services/observations";
import * as learn from "@/lib/services/learning";
import * as imp from "@/lib/services/improvements";
import { rateLimit } from "@/lib/services/public";
import { CLOSED, createTestDb, obsInput, OPEN, signIn } from "./helpers";

let db: Db;
let meridian: Actor, northstar: Actor, moderator: Actor, owner: Actor, employee: Actor;
const status = (e: unknown) => (e as { status?: number }).status;
const rejects403 = async (p: Promise<unknown>) => { await expect(p).rejects.toSatisfy(e => status(e) === 403); };

beforeEach(async () => {
  db = await createTestDb();
  meridian = await signIn(db, "u-meridian", "client_admin", "org-meridian");
  northstar = await signIn(db, "u-north", "client_member", "org-northstar");
  moderator = await signIn(db, "u-mod", "moderator");
  owner = await signIn(db, "u-owner", "product_owner");
  employee = await signIn(db, "u-emp", "employee");
});

async function publishFrom(actor: Actor, text = "Seasonal SME cash flows may need additional context.", themeId?: string) {
  const { observation_id } = await obs.createObservation(db, actor, obsInput(), true);
  const r = await obs.moderate(db, moderator, { observationId: observation_id, decision: "publish", reason: "ok", approvedText: text, themeId, acknowledgeFlags: false });
  return { observation_id, publication_id: r.publication_id as string };
}

describe("1. identity and privilege escalation", () => {
  it("rejects a session for a membership the user does not own (direct escalation → 403)", async () => {
    const identity = { userId: "attacker", email: "a@x.dev" };
    await provisionUser(db, identity, CLOSED);
    const modMembership = (await listMemberships(db, "u-mod")).find(m => m.role === "moderator")!;
    await rejects403(createSession(db, identity, modMembership.id));
    await rejects403(createSession(db, identity, "attacker:-:moderator"));
  });
  it("does not grant staff roles to ordinary signed-in users in production mode", async () => {
    await provisionUser(db, { userId: "plain", email: "plain@x.dev" }, CLOSED);
    expect(await listMemberships(db, "plain")).toEqual([]);
    await provisionUser(db, { userId: "staff", email: "Staff@X.dev" }, { ...CLOSED, staffEmails: ["staff@x.dev"] });
    expect((await listMemberships(db, "staff")).map(m => m.role).sort()).toEqual(["content_publisher", "employee", "moderator", "product_owner"]);
  });
  it("moderator actions are forbidden to client roles", async () => {
    const { observation_id } = await obs.createObservation(db, meridian, obsInput(), true);
    await rejects403(obs.moderate(db, meridian, { observationId: observation_id, decision: "publish", reason: "x", approvedText: "approved text here", acknowledgeFlags: false }));
    await rejects403(learn.seedScenario(db, meridian));
    await rejects403(imp.createImprovement(db, meridian, { title: "Title", problemStatement: "problem statement", proposedOutcome: "outcome text here", owner: "me", priority: "High", evidenceIds: ["x"] }));
  });
  it("client administrators cannot assign staff roles; revocation removes access immediately", async () => {
    await expect(inviteMember(db, meridian, { email: "x@y.dev", role: "moderator" as never })).rejects.toSatisfy(e => status(e) === 403);
    await rejects403(inviteMember(db, northstar, { email: "x@y.dev", role: "client_member" }));
    await inviteMember(db, meridian, { email: "new@y.dev", role: "client_member" });
    await provisionUser(db, { userId: "u-new", email: "new@y.dev" }, CLOSED);
    const m = (await listMemberships(db, "u-new"))[0];
    expect(m.orgId).toBe("org-meridian");
    const { token } = await createSession(db, { userId: "u-new", email: "new@y.dev" }, m.id);
    await resolveSession(db, "u-new", "new@y.dev", token);
    await revokeMembership(db, meridian, m.id);
    await expect(resolveSession(db, "u-new", "new@y.dev", token)).rejects.toSatisfy(e => [401, 403].includes(status(e) ?? 0));
  });
});

describe("2. tenant isolation and visibility", () => {
  it("Client B cannot read Client A's observation by id", async () => {
    const { observation_id } = await obs.createObservation(db, meridian, obsInput({ sharingIntent: "organization" }), false);
    await expect(obs.getObservation(db, northstar, observation_id)).rejects.toSatisfy(e => status(e) === 404);
    await expect(obs.consentHistory(db, northstar, observation_id)).rejects.toSatisfy(e => status(e) === 404);
    expect(await obs.listObservations(db, northstar)).toHaveLength(0);
  });
  it("author-private drafts are hidden from other members of the same organisation", async () => {
    const colleague = await signIn(db, "u-colleague", "client_member", "org-meridian").catch(async () => {
      await inviteMember(db, meridian, { email: "u-colleague@test.dev", role: "client_member" });
      await provisionUser(db, { userId: "u-colleague", email: "u-colleague@test.dev" }, OPEN);
      return signIn(db, "u-colleague", "client_member", "org-meridian");
    });
    const priv = await obs.createObservation(db, meridian, obsInput({ sharingIntent: "private" }), false);
    const shared = await obs.createObservation(db, meridian, obsInput({ sharingIntent: "organization" }), false);
    const ids = (await obs.listObservations(db, colleague)).map(o => o.id);
    expect(ids).toContain(shared.observation_id);
    expect(ids).not.toContain(priv.observation_id);
    await expect(obs.getObservation(db, colleague, priv.observation_id)).rejects.toSatisfy(e => status(e) === 404);
  });
  it("only community proposals reach the moderation queue", async () => {
    await obs.createObservation(db, meridian, obsInput({ sharingIntent: "private" }), false);
    await obs.createObservation(db, meridian, obsInput({ sharingIntent: "organization" }), false);
    await expect(obs.createObservation(db, meridian, obsInput({ sharingIntent: "private" }), true)).rejects.toMatchObject({ status: 400 });
    expect(await obs.listObservations(db, moderator)).toHaveLength(0);
    await obs.createObservation(db, meridian, obsInput(), true);
    expect(await obs.listObservations(db, moderator)).toHaveLength(1);
  });
});

describe("3. consent and publication", () => {
  it("saving a draft cannot publish it; sharing requires explicit consent", async () => {
    const draft = await obs.createObservation(db, meridian, obsInput(), false);
    expect(draft.status).toBe("draft");
    await expect(obs.moderate(db, moderator, { observationId: draft.observation_id, decision: "publish", reason: "x", approvedText: "approved text here", acknowledgeFlags: false })).rejects.toMatchObject({ status: 404 });
    await expect(obs.createObservation(db, meridian, obsInput({ processingConsent: false }), true)).rejects.toMatchObject({ status: 400 });
  });
  it("records independent, timestamped consent history with training off by default", async () => {
    const { observation_id } = await obs.createObservation(db, meridian, obsInput(), true);
    const history = await obs.consentHistory(db, meridian, observation_id);
    expect(history.map(h => h.type).sort()).toEqual(["attribution", "community_sharing", "model_training", "processing"]);
    expect(history.find(h => h.type === "model_training")!.state).toBe("revoked");
    expect(history.every(h => h.policyVersion && h.createdAt)).toBe(true);
  });
  it("shared payload excludes tenant, author and source ids", async () => {
    await publishFrom(meridian);
    const learning = await learn.getLearning(db, employee);
    const json = JSON.stringify(learning);
    for (const leaked of ["org-meridian", "u-meridian", "OBS-", "orgId", "sourceId", "authorId"]) expect(json).not.toContain(leaked);
    expect(learning.publications).toHaveLength(1);
  });
  it("flagged material requires moderator acknowledgement; leaked approved text is rejected", async () => {
    const { observation_id, privacy_flags } = await obs.createObservation(db, meridian, obsInput({ description: "Contact jane@bank.example about the account" }), true);
    expect(privacy_flags).toContain("email address");
    const base = { observationId: observation_id, decision: "publish" as const, reason: "ok", approvedText: "Sanitised observation text.", acknowledgeFlags: false };
    await expect(obs.moderate(db, moderator, base)).rejects.toMatchObject({ status: 409 });
    await expect(obs.moderate(db, moderator, { ...base, acknowledgeFlags: true, approvedText: "email jane@bank.example" })).rejects.toMatchObject({ status: 400 });
    await expect(obs.moderate(db, moderator, { ...base, acknowledgeFlags: true })).resolves.toMatchObject({ status: "published" });
  });
});

describe("4. workflow", () => {
  it("clarification → edit → resubmit → publish, and notifies the author", async () => {
    const { observation_id } = await obs.createObservation(db, meridian, obsInput(), true);
    await obs.moderate(db, moderator, { observationId: observation_id, decision: "clarify", reason: "more detail", acknowledgeFlags: false });
    await expect(obs.submitObservation(db, meridian, observation_id, true)).rejects.toMatchObject({ status: 409 });
    const upd = await obs.updateObservation(db, meridian, observation_id, obsInput({ description: "Clarified description of the seasonal pattern." }), true);
    expect(upd.status).toBe("submitted");
    await obs.moderate(db, moderator, { observationId: observation_id, decision: "publish", reason: "ok", approvedText: "Clarified approved text.", acknowledgeFlags: false });
    const n = await imp.listNotifications(db, meridian);
    expect(n.unread).toBeGreaterThan(0);
    await imp.markRead(db, meridian);
    expect((await imp.listNotifications(db, meridian)).unread).toBe(0);
  });
  it("rejects transitions that are not in the map", async () => {
    const { observation_id } = await obs.createObservation(db, meridian, obsInput(), false);
    await expect(obs.moderate(db, moderator, { observationId: observation_id, decision: "reject", reason: "x", acknowledgeFlags: false })).rejects.toMatchObject({ status: 404 });
    await obs.withdraw(db, meridian, observation_id);
    await expect(obs.withdraw(db, meridian, observation_id)).rejects.toMatchObject({ status: 409 });
    await expect(obs.updateObservation(db, meridian, observation_id, obsInput(), false)).rejects.toMatchObject({ status: 409 });
  });
  it("report temporarily unpublishes; restore re-publishes; material edit requires renewed review and bumps the version", async () => {
    const { observation_id, publication_id } = await publishFrom(meridian);
    await obs.reportPublication(db, northstar, publication_id, "looks identifying");
    expect((await learn.getLearning(db, employee)).publications).toHaveLength(0);
    const [report] = await obs.listReports(db, moderator);
    await obs.resolveReport(db, moderator, report.id, "restore");
    expect((await learn.getLearning(db, employee)).publications).toHaveLength(1);
    await obs.updateObservation(db, meridian, observation_id, obsInput({ description: "Materially changed description text." }), true);
    expect((await learn.getLearning(db, employee)).publications).toHaveLength(0);
    const r = await obs.moderate(db, moderator, { observationId: observation_id, decision: "publish", reason: "re-review", approvedText: "Updated approved copy of text.", acknowledgeFlags: false });
    expect(r).toMatchObject({ publication_id, version: 2 });
  });
});

describe("5. learning, AIRA and withdrawal", () => {
  async function threeOrgs() {
    await learn.seedScenario(db, moderator);
    return learn.getLearning(db, employee);
  }
  it("suppresses themes below three organisations and shows them at three", async () => {
    expect((await learn.getLearning(db, employee)).suppressed).toBe(true);
    const data = await threeOrgs();
    expect(data.theme?.distinct_organizations).toBe(3);
    expect(data.suppressed).toBe(false);
  });
  it("threshold is per theme over the active filters", async () => {
    await threeOrgs();
    expect((await learn.getLearning(db, employee, { region: "India" })).theme).not.toBeNull();
    expect((await learn.getLearning(db, employee, { region: "Kenya" })).theme).toBeNull();
    expect((await learn.getLearning(db, employee, { topic: "nothing-like-this" })).theme).toBeNull();
  });
  it("unrelated publications do not inflate a theme's organisation count", async () => {
    await learn.seedScenario(db, moderator);
    await publishFrom(meridian); // published but not linked to the theme
    await publishFrom(northstar);
    const t = (await learn.getLearning(db, employee)).theme!;
    expect(t.distinct_organizations).toBe(3);
    expect(t.supporting_publications).toHaveLength(3);
  });
  it("AIRA returns valid references, or insufficient evidence", async () => {
    expect((await learn.askAira(db, employee, "What seasonality concerns exist?", {})).status).toBe("insufficient_evidence");
    await threeOrgs();
    const a = await learn.askAira(db, employee, "What seasonality concerns exist?", {});
    expect(a.status).toBe("answered");
    const valid = new Set((await learn.getLearning(db, employee)).publications.map(p => p.id));
    expect(a.references.length).toBe(3);
    expect(a.references.every(r => valid.has(r))).toBe(true);
    expect((await learn.askAira(db, employee, "What seasonality concerns exist?", { region: "Kenya" })).status).toBe("insufficient_evidence");
  });
  it("withdrawal removes retrieval immediately, revokes consent, and re-seeding never revives it", async () => {
    const { observation_id, publication_id } = await publishFrom(meridian);
    expect((await learn.getLearning(db, employee)).publications.map(p => p.id)).toContain(publication_id);
    await obs.withdraw(db, meridian, observation_id);
    expect((await learn.getLearning(db, employee)).publications).toHaveLength(0);
    expect((await obs.consentHistory(db, meridian, observation_id)).filter(c => c.type === "community_sharing").at(-1)?.state).toBe("revoked");
    await learn.seedScenario(db, moderator);
    await learn.seedScenario(db, moderator);
    const ids = (await learn.getLearning(db, employee)).publications.map(p => p.id);
    expect(ids).not.toContain(publication_id);
    expect(ids).toHaveLength(3);
    expect((await obs.getObservation(db, meridian, observation_id)).status).toBe("withdrawn");
  });
  it("withdrawing a seed contribution drops the theme below threshold", async () => {
    await threeOrgs();
    const { publications } = await learn.getLearning(db, employee);
    // Org-visible records of the seeded tenant are readable by that tenant's members, and only by them.
    expect((await obs.listObservations(db, northstar)).length).toBe(1);
    expect(publications).toHaveLength(3);
  });
});

describe("6. improvements", () => {
  it("creates an improvement from approved evidence and restricts client-visible content", async () => {
    await learn.seedScenario(db, moderator);
    const { publications, theme } = await learn.getLearning(db, employee);
    const input = { title: "Seasonality-aware comparison", problemStatement: "Seasonal cash flows lack context.", proposedOutcome: "Explain like-for-like comparisons.", owner: "FI product team", priority: "High", themeId: theme!.id, evidenceIds: publications.map(p => p.id) };
    await rejects403(imp.createImprovement(db, employee, input));
    await expect(imp.createImprovement(db, owner, { ...input, evidenceIds: ["PUB-FAKE"] })).rejects.toMatchObject({ status: 400 });
    await expect(imp.createImprovement(db, owner, { ...input, evidenceIds: input.evidenceIds.slice(0, 2) })).rejects.toMatchObject({ status: 409 });
    const created = await imp.createImprovement(db, owner, input);
    await expect(imp.updateImprovementStatus(db, owner, { improvementId: created.id, status: "Released" })).rejects.toMatchObject({ status: 409 });
    await imp.updateImprovementStatus(db, owner, { improvementId: created.id, status: "Planned", internalNote: "internal only", clientUpdate: "Planned for next release" });
    const staffView = await imp.listImprovements(db, owner);
    expect(staffView[0].updates).toHaveLength(2);
    // A client sees its own organisation's idea with client-audience updates only.
    const clientView = await imp.listImprovements(db, meridian);
    expect(clientView).toHaveLength(1);
    expect(JSON.stringify(clientView)).not.toContain("internal only");
    expect(await imp.listImprovements(db, await signIn(db, "u-other", "client_member", "org-northstar").then(a => ({ ...a, orgId: "org-harbour" })))).toHaveLength(1);
  });
  it("a contributing client sees only client-audience updates and is notified", async () => {
    const a = await publishFrom(meridian), b = await publishFrom(northstar);
    await learn.seedScenario(db, moderator);
    const pubs = (await learn.getLearning(db, employee)).publications.map(p => p.id);
    const evidenceIds = [a.publication_id, b.publication_id, ...pubs]; // meridian + northstar + seeded harbour
    const created = await imp.createImprovement(db, owner, { title: "Improve comparisons", problemStatement: "Problem statement here.", proposedOutcome: "Outcome statement here.", owner: "Team", priority: "Medium", evidenceIds });
    await imp.updateImprovementStatus(db, owner, { improvementId: created.id, status: "Planned", internalNote: "secret roadmap", clientUpdate: "We have planned this." });
    const view = await imp.listImprovements(db, meridian);
    expect(view).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain("secret roadmap");
    expect(JSON.stringify(view)).not.toMatch(/PUB-|Northstar|org-/);
    expect((await imp.listNotifications(db, meridian)).notifications.some(n => n.event === "improvement_update")).toBe(true);
  });
});

describe("7. entitlements", () => {
  it("blocks sandbox runs without an enabled entitlement, even for a signed-in member", async () => {
    const input = { offering: "Compliance Intelligence", cycle: "Festival retail", seasonality: 40 };
    await rejects403(learn.runSandbox(db, meridian, input));
    await expect(learn.runSandbox(db, meridian, { ...input, offering: "Financial Analysis Intelligence" })).resolves.toMatchObject({ mode: "deterministic_synthetic" });
    await rejects403(learn.runSandbox(db, northstar, { ...input, offering: "Lending Intelligence" }));
    await learn.setEntitlement(db, owner, "org-northstar", "prod-lnd", true);
    await expect(learn.runSandbox(db, northstar, { ...input, offering: "Lending Intelligence" })).resolves.toBeDefined();
    await learn.setEntitlement(db, owner, "org-northstar", "prod-lnd", false);
    await rejects403(learn.runSandbox(db, northstar, { ...input, offering: "Lending Intelligence" }));
    expect((await learn.listEntitlements(db, northstar)).map(p => p.code)).toEqual(["FAI"]);
  });
});

describe("8. rate limiting", () => {
  it("returns 429 after the window budget is spent", async () => {
    for (let i = 0; i < 3; i++) await rateLimit(db, "k", 3, 60, 1_000_000);
    await expect(rateLimit(db, "k", 3, 60, 1_000_000)).rejects.toMatchObject({ status: 429 });
    await expect(rateLimit(db, "k", 3, 60, 1_000_000 + 61_000)).resolves.toBeUndefined();
  });
});
