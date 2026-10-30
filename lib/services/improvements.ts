import { and, desc, eq, inArray } from "drizzle-orm";
import { improvementEvidence, improvements, improvementUpdates, notifications, observations, publications, themeEvidence } from "@/db/schema";
import { MIN_ORGANISATIONS } from "@/lib/domain/aira";
import { kindOf } from "@/lib/domain/rbac";
import { assertTransition, IMPROVEMENT_TRANSITIONS, type ImprovementStatus } from "@/lib/domain/workflow";
import { ApiError, type Actor, type Db, type Stmt, auditStmt, notifyStmt, now, requirePermission, runBatch, uid } from "./core";

export type ImprovementInput = { title: string; problemStatement: string; proposedOutcome: string; owner: string; priority: string; themeId?: string; evidenceIds: string[] };

export async function createImprovement(db: Db, actor: Actor, input: ImprovementInput) {
  requirePermission(actor, "improvement:manage");
  const ids = [...new Set(input.evidenceIds)];
  const pubs = await db.select({ id: publications.id, offering: publications.offering, orgId: observations.orgId, authorId: observations.authorId })
    .from(publications).innerJoin(observations, eq(publications.sourceId, observations.id)).where(inArray(publications.id, ids));
  const approved = await db.select({ id: publications.id }).from(publications).where(and(inArray(publications.id, ids), eq(publications.status, "published")));
  const approvedIds = new Set(approved.map(a => a.id));
  const bad = ids.filter(id => !pubs.some(p => p.id === id) || !approvedIds.has(id));
  if (bad.length) throw new ApiError(`Evidence is not approved or not retrievable: ${bad.join(", ")}`, 400);
  if (input.themeId) {
    const links = await db.select().from(themeEvidence).where(eq(themeEvidence.themeId, input.themeId));
    const inTheme = new Set(links.map(l => l.publicationId));
    const outside = ids.filter(id => !inTheme.has(id));
    if (outside.length) throw new ApiError(`Evidence is not linked to the selected theme: ${outside.join(", ")}`, 400);
  }
  if (new Set(pubs.map(p => p.orgId)).size < MIN_ORGANISATIONS) throw new ApiError("Theme is suppressed below the three-organisation threshold", 409);
  const id = uid("IMP");
  const contributors = [...new Set(pubs.map(p => p.authorId).filter(a => !a.startsWith("synthetic-")))];
  await runBatch(db, [
    db.insert(improvements).values({ id, title: input.title, problemStatement: input.problemStatement, offering: pubs[0].offering, proposedOutcome: input.proposedOutcome, owner: input.owner, priority: input.priority, status: "Under review", evidenceIds: ids.join(",") }),
    db.insert(improvementEvidence).values(ids.map(publicationId => ({ improvementId: id, publicationId }))),
    // Contributors are told their evidence was used; no other organisation is named.
    ...contributors.map(c => notifyStmt(db, c, "improvement_created", "An improvement idea now cites your approved contribution.")),
    auditStmt(db, actor.userId, "create_improvement", id, ids.join(","))]);
  return { id, status: "Under review", evidenceIds: ids };
}

export async function updateImprovementStatus(db: Db, actor: Actor, input: { improvementId: string; status: ImprovementStatus; internalNote?: string; clientUpdate?: string }) {
  requirePermission(actor, "improvement:manage");
  const [row] = await db.select().from(improvements).where(eq(improvements.id, input.improvementId)).limit(1);
  if (!row) throw new ApiError("Improvement not found", 404);
  if (row.status !== input.status) assertTransition(IMPROVEMENT_TRANSITIONS, row.status as ImprovementStatus, input.status);
  const ev = await db.select({ authorId: observations.authorId }).from(improvementEvidence).innerJoin(publications, eq(improvementEvidence.publicationId, publications.id))
    .innerJoin(observations, eq(publications.sourceId, observations.id)).where(eq(improvementEvidence.improvementId, row.id));
  const contributors = [...new Set(ev.map(e => e.authorId).filter(a => !a.startsWith("synthetic-")))];
  const stmts: Stmt[] = [db.update(improvements).set({ status: input.status, updatedAt: now() }).where(eq(improvements.id, row.id))];
  if (input.internalNote) stmts.push(db.insert(improvementUpdates).values({ id: uid("UPD"), improvementId: row.id, audience: "internal", body: input.internalNote, authorId: actor.userId }));
  if (input.clientUpdate) {
    stmts.push(db.insert(improvementUpdates).values({ id: uid("UPD"), improvementId: row.id, audience: "client", body: input.clientUpdate, authorId: actor.userId }),
      ...contributors.map(c => notifyStmt(db, c, "improvement_update", `Update on an idea citing your contribution: ${input.clientUpdate}`)));
  }
  stmts.push(auditStmt(db, actor.userId, "improvement_status", row.id, `${row.status} → ${input.status}`));
  await runBatch(db, stmts);
  return { id: row.id, status: input.status };
}

export async function listImprovements(db: Db, actor: Actor) {
  const rows = await db.select().from(improvements).orderBy(desc(improvements.updatedAt));
  const updates = await db.select().from(improvementUpdates).orderBy(desc(improvementUpdates.createdAt));
  const staff = ["product_owner", "employee"].includes(actor.role);
  if (staff) {
    return rows.map(r => ({ ...r, updates: updates.filter(u => u.improvementId === r.id).map(u => ({ id: u.id, improvementId: u.improvementId, audience: u.audience, body: u.body, createdAt: u.createdAt })) }));
  }
  if (kindOf(actor.role) !== "client" || !actor.orgId) throw new ApiError("Not authorised", 403);
  // Clients see only ideas that cite their own organisation's contribution, with client-audience updates and no other-organisation evidence.
  const mine = await db.select({ improvementId: improvementEvidence.improvementId }).from(improvementEvidence)
    .innerJoin(publications, eq(improvementEvidence.publicationId, publications.id)).innerJoin(observations, eq(publications.sourceId, observations.id)).where(eq(observations.orgId, actor.orgId));
  const allowed = new Set(mine.map(m => m.improvementId));
  return rows.filter(r => allowed.has(r.id)).map(r => ({ id: r.id, title: r.title, offering: r.offering, status: r.status, updatedAt: r.updatedAt,
    updates: updates.filter(u => u.improvementId === r.id && u.audience === "client").map(u => ({ id: u.id, audience: u.audience, body: u.body, createdAt: u.createdAt })) }));
}

export async function listNotifications(db: Db, actor: Actor) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, actor.userId)).orderBy(desc(notifications.createdAt)).limit(30);
  return { notifications: rows, unread: rows.filter(r => !r.readAt).length };
}

export async function markRead(db: Db, actor: Actor, ids?: string[]) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, actor.userId));
  const target = rows.filter(r => !r.readAt && (!ids || ids.includes(r.id))).map(r => r.id);
  if (target.length) await db.update(notifications).set({ readAt: now() }).where(inArray(notifications.id, target));
  return { marked: target.length };
}
