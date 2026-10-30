import { and, desc, eq, gt } from "drizzle-orm";
import { bookmarks, comments, contentItems, entitlements, experiments, memberships, organizations, products, profiles, publications, supportGrants, teamMembers, teams, themes, themeEvidence } from "@/db/schema";
import { canReadContent } from "@/lib/domain/content";
import { kindOf } from "@/lib/domain/rbac";
import { ApiError, type Actor, type Db, auditStmt, notifyStmt, requirePermission, runBatch, uid } from "./core";

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
type ContentInput = { kind: string; audience: string; orgId?: string; mediaUrl?: string; title: string; body: string };
export async function createContent(db: Db, actor: Actor, i: ContentInput, publish: boolean) {
  requirePermission(actor, "content:publish");
  if (i.orgId && i.audience !== "client") throw new ApiError("Organisation-specific content must target the client audience", 400);
  if (i.orgId) { const [o] = await db.select().from(organizations).where(eq(organizations.id, i.orgId)).limit(1); if (!o) throw new ApiError("Organisation not found", 404); }
  const id = uid("CNT");
  await runBatch(db, [db.insert(contentItems).values({ id, kind: i.kind, audience: i.audience, orgId: i.orgId ?? null, mediaUrl: i.mediaUrl ?? null, title: i.title, body: i.body, status: publish ? "published" : "draft", authorId: actor.userId }),
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
export async function listContent(db: Db, actor: Actor) {
  const isPublisher = actor.role === "content_publisher" || actor.role === "product_owner";
  const rows = await db.select().from(contentItems).orderBy(desc(contentItems.createdAt));
  return rows.filter(r => canReadContent(actor, r, isPublisher)).map(r => ({ id: r.id, kind: r.kind, audience: r.audience, title: r.title, body: r.body, mediaUrl: r.mediaUrl, status: r.status, createdAt: r.createdAt }));
}
export async function publicContent(db: Db) {
  const rows = await db.select().from(contentItems).where(and(eq(contentItems.audience, "public"), eq(contentItems.status, "published"))).orderBy(desc(contentItems.createdAt));
  return rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, mediaUrl: r.mediaUrl, createdAt: r.createdAt }));
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
  const rows = await db.select().from(comments).where(eq(comments.publicationId, publicationId)).orderBy(comments.createdAt);
  return rows.map(r => ({ id: r.id, authorLabel: r.authorLabel, body: r.body, createdAt: r.createdAt }));
}

// ---- Employee lab: experiments and hackathon team spaces ------------------
export async function submitExperiment(db: Db, actor: Actor, i: { title: string; hypothesis: string }) {
  requirePermission(actor, "lab:use");
  const id = uid("EXP");
  await runBatch(db, [db.insert(experiments).values({ id, ...i, authorId: actor.userId }), auditStmt(db, actor.userId, "submit_experiment", id)]);
  return { id, status: "proposed" };
}
export async function listExperiments(db: Db, actor: Actor) {
  requirePermission(actor, "lab:use");
  return db.select().from(experiments).orderBy(desc(experiments.createdAt));
}
export async function createTeam(db: Db, actor: Actor, i: { name: string; brief: string }) {
  requirePermission(actor, "lab:use");
  const id = uid("TEAM");
  await runBatch(db, [db.insert(teams).values({ id, ...i, ownerId: actor.userId }), db.insert(teamMembers).values({ teamId: id, userId: actor.userId, label: actor.label }), auditStmt(db, actor.userId, "create_team", id)]);
  return { id };
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
  const all = await db.select().from(teams).orderBy(desc(teams.createdAt)), members = await db.select().from(teamMembers);
  return all.map(t => ({ ...t, members: members.filter(m => m.teamId === t.id).length, joined: members.some(m => m.teamId === t.id && m.userId === actor.userId) }));
}
