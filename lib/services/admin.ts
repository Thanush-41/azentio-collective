import { and, desc, eq, gt } from "drizzle-orm";
import { auditEvents, bookmarks, comments, contentItems, entitlements, experiments, feedback, supportRequests, memberships, organizations, products, profiles, publications, supportGrants, teamMembers, teams, themes, themeEvidence } from "@/db/schema";
import { canReadContent } from "@/lib/domain/content";
import { can, kindOf } from "@/lib/domain/rbac";
import { ApiError, type Actor, type Db, auditStmt, notifyStmt, now, requirePermission, runBatch, uid, usersWithRole } from "./core";

// ---- Theme authoring -------------------------------------------------------
export async function createTheme(db: Db, actor: Actor, i: { title: string; topic: string; offering: string; summary: string; suggestedImprovement: string }) {
  requirePermission(actor, "theme:manage");
  const id = uid("THM");
  await runBatch(db, [db.insert(themes).values({ id, ...i, createdBy: actor.userId }), auditStmt(db, actor.userId, "create_theme", id, i.title)]);
  return { id };
}
export async function listThemesAdmin(db: Db, actor: Actor) {
  requirePermission(actor, "theme:manage");
  const all = await db.select().from(themes).orderBy(desc(themes.createdAt));
  const links = await db.select().from(themeEvidence);
  return all.map(t => ({ ...t, evidenceCount: links.filter(l => l.themeId === t.id).length }));
}
export async function linkEvidence(db: Db, actor: Actor, themeId: string, publicationId: string) {
  requirePermission(actor, "theme:manage");
  const [t] = await db.select().from(themes).where(eq(themes.id, themeId)).limit(1);
  const [p] = await db.select().from(publications).where(and(eq(publications.id, publicationId), eq(publications.status, "published"))).limit(1);
  if (!t || !p) throw new ApiError("Theme or published evidence not found", 404);
  await runBatch(db, [db.insert(themeEvidence).values({ themeId, publicationId }).onConflictDoNothing(), auditStmt(db, actor.userId, "link_evidence", themeId, publicationId)]);
  return { themeId, publicationId };
}

// ---- Entitlement administration -------------------------------------------
export async function entitlementMatrix(db: Db, actor: Actor) {
  requirePermission(actor, "entitlements:manage");
  return { organizations: await db.select().from(organizations), products: await db.select().from(products), entitlements: await db.select().from(entitlements) };
}

// ---- Audited support / moderator authorisation ----------------------------
export async function grantSupportAccess(db: Db, actor: Actor, i: { email: string; hours: number }) {
  requirePermission(actor, "support:grant");
  if (!actor.orgId) throw new ApiError("Organisation required", 403);
  const [profile] = await db.select().from(profiles).where(eq(profiles.email, i.email.toLowerCase())).limit(1);
  const staff = profile && await db.select().from(memberships).where(and(eq(memberships.userId, profile.userId), eq(memberships.status, "active")));
  if (!profile || !staff?.some(m => m.role === "moderator")) throw new ApiError("Support access can only be granted to an Azentio moderator", 400);
  const id = uid("SUP"), expiresAt = new Date(Date.now() + i.hours * 3600_000).toISOString();
  await runBatch(db, [db.insert(supportGrants).values({ id, orgId: actor.orgId, granteeUserId: profile.userId, expiresAt, grantedBy: actor.userId }),
    notifyStmt(db, profile.userId, "support_grant", "A client organisation granted you time-limited support access."), auditStmt(db, actor.userId, "grant_support", id, `${profile.userId} until ${expiresAt}`)]);
  return { id, expiresAt };
}
export async function revokeSupportAccess(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "support:grant");
  const [g] = await db.select().from(supportGrants).where(eq(supportGrants.id, id)).limit(1);
  if (!g || g.orgId !== actor.orgId) throw new ApiError("Grant not found", 404);
  await runBatch(db, [db.update(supportGrants).set({ status: "revoked" }).where(eq(supportGrants.id, id)), auditStmt(db, actor.userId, "revoke_support", id)]);
  return { id, status: "revoked" };
}
export async function listSupportGrants(db: Db, actor: Actor) {
  requirePermission(actor, "support:grant");
  return db.select().from(supportGrants).where(eq(supportGrants.orgId, actor.orgId ?? "")).orderBy(desc(supportGrants.createdAt));
}
export async function hasSupportGrant(db: Db, actor: Actor, orgId: string) {
  if (actor.role !== "moderator") return false;
  const rows = await db.select().from(supportGrants).where(and(eq(supportGrants.orgId, orgId), eq(supportGrants.granteeUserId, actor.userId), eq(supportGrants.status, "active"), gt(supportGrants.expiresAt, new Date().toISOString())));
  return rows.length > 0;
}

// ---- Content (broadcasts, release notes, knowledge, client resources) -----
type ContentInput = { kind: string; audience: string; orgId?: string; mediaUrl?: string; owner?: string; reviewDate?: string; title: string; body: string };
export async function createContent(db: Db, actor: Actor, i: ContentInput, publish: boolean) {
  requirePermission(actor, "content:publish");
  if (i.orgId && i.audience !== "client") throw new ApiError("Organisation-specific content must target the client audience", 400);
  if (i.mediaUrl && i.kind !== "recording") throw new ApiError("A media link is only allowed on recordings", 400);
  if (i.orgId) { const [o] = await db.select().from(organizations).where(eq(organizations.id, i.orgId)).limit(1); if (!o) throw new ApiError("Organisation not found", 404); }
  const id = uid("CNT");
  await runBatch(db, [db.insert(contentItems).values({ id, kind: i.kind, audience: i.audience, orgId: i.orgId ?? null, mediaUrl: i.mediaUrl ?? null, owner: i.owner ?? null, reviewDate: i.reviewDate ?? null, title: i.title, body: i.body, status: publish ? "published" : "draft", authorId: actor.userId }),
    auditStmt(db, actor.userId, publish ? "publish_content" : "draft_content", id, `${i.kind}/${i.audience}`)]);
  return { id, status: publish ? "published" : "draft" };
}
export async function setContentStatus(db: Db, actor: Actor, id: string, status: "published" | "archived") {
  requirePermission(actor, "content:publish");
  const [c] = await db.select().from(contentItems).where(eq(contentItems.id, id)).limit(1);
  if (!c) throw new ApiError("Content not found", 404);
  await runBatch(db, [db.update(contentItems).set({ status }).where(eq(contentItems.id, id)), auditStmt(db, actor.userId, `content:${status}`, id)]);
  return { id, status };
}
/** The raw media URL is never returned; clients use /api/media/<id>, which re-checks the audience on every request. */
const mediaPath = (r: { id: string; mediaUrl: string | null }) => (r.mediaUrl ? `/api/media/${r.id}` : null);

export async function listContent(db: Db, actor: Actor, q?: string) {
  const isPublisher = actor.role === "content_publisher" || actor.role === "product_owner";
  const rows = await db.select().from(contentItems).orderBy(desc(contentItems.createdAt));
  const fb = await db.select().from(feedback).where(eq(feedback.kind, "knowledge"));
  const needle = q?.trim().toLowerCase();
  return rows.filter(r => canReadContent(actor, r, isPublisher) && (!needle || `${r.title} ${r.body} ${r.owner ?? ""}`.toLowerCase().includes(needle)))
    .map(r => ({ id: r.id, kind: r.kind, audience: r.audience, title: r.title, body: r.body, mediaPath: mediaPath(r), owner: r.owner, reviewDate: r.reviewDate, status: r.status, createdAt: r.createdAt,
      useful: fb.filter(f => f.refId === r.id && f.rating === "useful").length, needsUpdate: fb.filter(f => f.refId === r.id && f.rating === "needs_update").length }));
}

/** Server-side media gate: resolves the target only if the caller may read the item. */
export async function resolveMedia(db: Db, actor: Actor | null, id: string) {
  const [r] = await db.select().from(contentItems).where(eq(contentItems.id, id)).limit(1);
  if (!r || !r.mediaUrl || r.kind !== "recording") throw new ApiError("Recording not found", 404);
  if (r.status === "published" && r.audience === "public") return r.mediaUrl;
  if (!actor) throw new ApiError("Sign in is required", 401);
  const isPublisher = actor.role === "content_publisher" || actor.role === "product_owner";
  if (!canReadContent(actor, r, isPublisher)) throw new ApiError("Recording not found", 404);
  return r.mediaUrl;
}
export async function publicContent(db: Db) {
  const rows = await db.select().from(contentItems).where(and(eq(contentItems.audience, "public"), eq(contentItems.status, "published"))).orderBy(desc(contentItems.createdAt));
  return rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, mediaPath: mediaPath(r), createdAt: r.createdAt }));
}

// ---- Bookmarks, saved searches, comments ----------------------------------
export async function addBookmark(db: Db, actor: Actor, i: { kind: "publication" | "search"; ref: string; label: string }) {
  requirePermission(actor, "social");
  if (i.kind === "publication") { const [p] = await db.select().from(publications).where(and(eq(publications.id, i.ref), eq(publications.status, "published"))).limit(1); if (!p) throw new ApiError("Publication not found", 404); }
  const id = uid("BKM");
  await db.insert(bookmarks).values({ id, userId: actor.userId, ...i });
  return { id };
}
export async function listBookmarks(db: Db, actor: Actor) {
  requirePermission(actor, "social");
  return db.select().from(bookmarks).where(eq(bookmarks.userId, actor.userId)).orderBy(desc(bookmarks.createdAt));
}
export async function removeBookmark(db: Db, actor: Actor, id: string) {
  const mine = await db.select().from(bookmarks).where(and(eq(bookmarks.id, id), eq(bookmarks.userId, actor.userId)));
  if (!mine.length) throw new ApiError("Bookmark not found", 404);
  await db.delete(bookmarks).where(eq(bookmarks.id, id));
  return { id };
}
/** Comments are on approved shared copies only; authors appear as a role label, never an organisation. */
export async function addComment(db: Db, actor: Actor, publicationId: string, body: string) {
  requirePermission(actor, "social");
  const [p] = await db.select().from(publications).where(and(eq(publications.id, publicationId), eq(publications.status, "published"))).limit(1);
  if (!p) throw new ApiError("Publication not found", 404);
  const id = uid("CMT"), authorLabel = kindOf(actor.role) === "client" ? "Client contributor" : "Azentio team";
  await db.insert(comments).values({ id, publicationId, authorId: actor.userId, authorLabel, body });
  return { id };
}
export async function listComments(db: Db, actor: Actor, publicationId: string) {
  requirePermission(actor, "social");
  // Comments inherit the parent's current visibility: reported, withdrawn or pending-review publications expose nothing.
  const [p] = await db.select().from(publications).where(and(eq(publications.id, publicationId), eq(publications.status, "published"))).limit(1);
  if (!p) throw new ApiError("Publication not found", 404);
  const rows = await db.select().from(comments).where(eq(comments.publicationId, publicationId)).orderBy(comments.createdAt);
  return rows.map(r => ({ id: r.id, authorLabel: r.authorLabel, body: r.body, createdAt: r.createdAt }));
}

// ---- Employee lab: experiments and hackathon team spaces ------------------
export async function submitExperiment(db: Db, actor: Actor, i: { title: string; hypothesis: string; teamId?: string }) {
  requirePermission(actor, "lab:use");
  if (i.teamId) {
    const member = await db.select().from(teamMembers).where(and(eq(teamMembers.teamId, i.teamId), eq(teamMembers.userId, actor.userId)));
    if (!member.length) throw new ApiError("Join the team before adding experiments to it", 403);
  }
  const id = uid("EXP");
  await runBatch(db, [db.insert(experiments).values({ id, title: i.title, hypothesis: i.hypothesis, teamId: i.teamId ?? null, authorId: actor.userId }), auditStmt(db, actor.userId, "submit_experiment", id)]);
  return { id, status: "proposed" };
}
const EXP_NEXT: Record<string, string[]> = { proposed: ["running"], running: ["concluded"], concluded: [] };
export async function setExperimentStatus(db: Db, actor: Actor, id: string, status: string) {
  requirePermission(actor, "lab:use");
  const [e] = await db.select().from(experiments).where(eq(experiments.id, id)).limit(1);
  if (!e || e.authorId !== actor.userId) throw new ApiError("Experiment not found", 404);
  if (!EXP_NEXT[e.status]?.includes(status)) throw new ApiError(`Transition ${e.status} → ${status} is not permitted`, 409);
  await runBatch(db, [db.update(experiments).set({ status }).where(eq(experiments.id, id)), auditStmt(db, actor.userId, `experiment:${status}`, id)]);
  return { id, status };
}
export async function listExperiments(db: Db, actor: Actor) {
  requirePermission(actor, "lab:use");
  const rows = await db.select().from(experiments).orderBy(desc(experiments.createdAt)), fb = await db.select().from(feedback).where(eq(feedback.kind, "experiment"));
  return rows.map(r => ({ id: r.id, title: r.title, hypothesis: r.hypothesis, status: r.status, teamId: r.teamId, mine: r.authorId === actor.userId, createdAt: r.createdAt,
    useful: fb.filter(f => f.refId === r.id && f.rating === "useful").length, needsUpdate: fb.filter(f => f.refId === r.id && f.rating === "needs_update").length }));
}
/** Structured feedback (one rating per user per item). Knowledge items must be readable by the caller. */
export async function addFeedback(db: Db, actor: Actor, i: { kind: "knowledge" | "experiment"; refId: string; rating: "useful" | "needs_update"; comment: string }) {
  requirePermission(actor, "lab:use");
  if (i.kind === "knowledge") {
    const [c] = await db.select().from(contentItems).where(and(eq(contentItems.id, i.refId), eq(contentItems.kind, "knowledge"))).limit(1);
    if (!c || !canReadContent(actor, c, actor.role === "content_publisher" || actor.role === "product_owner")) throw new ApiError("Knowledge item not found", 404);
  } else {
    const [e] = await db.select().from(experiments).where(eq(experiments.id, i.refId)).limit(1);
    if (!e) throw new ApiError("Experiment not found", 404);
  }
  await db.insert(feedback).values({ id: uid("FBK"), kind: i.kind, refId: i.refId, userId: actor.userId, rating: i.rating, comment: i.comment })
    .onConflictDoUpdate({ target: [feedback.kind, feedback.refId, feedback.userId], set: { rating: i.rating, comment: i.comment } });
  return { ok: true };
}
export async function createTeam(db: Db, actor: Actor, i: { name: string; brief: string }) {
  requirePermission(actor, "lab:use");
  const id = uid("TEAM");
  await runBatch(db, [db.insert(teams).values({ id, ...i, ownerId: actor.userId }), db.insert(teamMembers).values({ teamId: id, userId: actor.userId, label: actor.label }), auditStmt(db, actor.userId, "create_team", id)]);
  return { id };
}
export async function updateTeam(db: Db, actor: Actor, i: { teamId: string; progress?: string; submissionUrl?: string }) {
  requirePermission(actor, "lab:use");
  const [t] = await db.select().from(teams).where(eq(teams.id, i.teamId)).limit(1);
  if (!t) throw new ApiError("Team not found", 404);
  if (t.ownerId !== actor.userId) throw new ApiError("Only the team owner can update progress and the submission link", 403);
  await runBatch(db, [db.update(teams).set({ progress: i.progress ?? t.progress, submissionUrl: i.submissionUrl ?? t.submissionUrl }).where(eq(teams.id, t.id)), auditStmt(db, actor.userId, "update_team", t.id)]);
  return { teamId: t.id };
}
export async function joinTeam(db: Db, actor: Actor, teamId: string) {
  requirePermission(actor, "lab:use");
  const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!t) throw new ApiError("Team not found", 404);
  await db.insert(teamMembers).values({ teamId, userId: actor.userId, label: actor.label }).onConflictDoNothing();
  return { teamId };
}
export async function listTeams(db: Db, actor: Actor) {
  requirePermission(actor, "lab:use");
  const all = await db.select().from(teams).orderBy(desc(teams.createdAt)), members = await db.select().from(teamMembers), exps = await db.select().from(experiments);
  return all.map(t => ({ id: t.id, name: t.name, brief: t.brief, progress: t.progress, submissionUrl: t.submissionUrl, isOwner: t.ownerId === actor.userId,
    members: members.filter(m => m.teamId === t.id).length, memberLabels: members.filter(m => m.teamId === t.id).map(m => m.label), experiments: exps.filter(e => e.teamId === t.id).length,
    joined: members.some(m => m.teamId === t.id && m.userId === actor.userId) }));
}

export async function renameBookmark(db: Db, actor: Actor, id: string, label: string) {
  const mine = await db.select().from(bookmarks).where(and(eq(bookmarks.id, id), eq(bookmarks.userId, actor.userId)));
  if (!mine.length) throw new ApiError("Bookmark not found", 404);
  await db.update(bookmarks).set({ label }).where(eq(bookmarks.id, id));
  return { id, label };
}

// ---- Audit visibility ------------------------------------------------------
export async function listAudit(db: Db, actor: Actor) {
  requirePermission(actor, "audit:read");
  const rows = await db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(100);
  return rows.map(r => ({ id: r.id, action: r.action, resource: r.resource, detail: r.detail.slice(0, 200), actor: r.actorId.slice(0, 12), createdAt: r.createdAt }));
}

// ---- Support requests ------------------------------------------------------
export async function createSupportRequest(db: Db, actor: Actor, i: { subject: string; body: string }) {
  requirePermission(actor, "support:create");
  if (!actor.orgId) throw new ApiError("Organisation required", 403);
  const id = uid("SUP-REQ");
  const staff = await usersWithRole(db, ["employee", "product_owner"]);
  await runBatch(db, [db.insert(supportRequests).values({ id, orgId: actor.orgId, authorId: actor.userId, ...i }),
    ...staff.map(u => notifyStmt(db, u, "support_request", `New support request ${id} from a client organisation.`)), auditStmt(db, actor.userId, "support_request", id)]);
  return { id, status: "open" };
}
export async function listSupportRequests(db: Db, actor: Actor) {
  if (can(actor.role, "support:manage")) return (await db.select().from(supportRequests).orderBy(desc(supportRequests.createdAt))).map(r => ({ ...r, orgId: r.orgId, authorId: undefined }));
  requirePermission(actor, "support:create");
  return (await db.select().from(supportRequests).where(eq(supportRequests.orgId, actor.orgId ?? "")).orderBy(desc(supportRequests.createdAt))).map(r => ({ id: r.id, subject: r.subject, body: r.body, status: r.status, reply: r.reply, createdAt: r.createdAt, updatedAt: r.updatedAt }));
}
export async function replySupportRequest(db: Db, actor: Actor, i: { id: string; reply: string; status: "open" | "closed" }) {
  requirePermission(actor, "support:manage");
  const [r] = await db.select().from(supportRequests).where(eq(supportRequests.id, i.id)).limit(1);
  if (!r) throw new ApiError("Request not found", 404);
  await runBatch(db, [db.update(supportRequests).set({ reply: i.reply, status: i.status, updatedAt: now() }).where(eq(supportRequests.id, i.id)),
    notifyStmt(db, r.authorId, "support_reply", `Your support request ${r.id} has an update.`), auditStmt(db, actor.userId, "support_reply", r.id, i.status)]);
  return { id: r.id, status: i.status };
}
