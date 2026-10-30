import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { auditEvents, memberships, notifications } from "@/db/schema";
import type { Role } from "@/lib/domain/rbac";
import { can, kindOf, type Permission } from "@/lib/domain/rbac";

export type Db = DrizzleD1Database<typeof schema>;
export type Stmt = BatchItem<"sqlite">;
export type Actor = { userId: string; email: string; membershipId: string; role: Role; orgId: string | null; label: string };

export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
export const now = () => new Date().toISOString();
export const POLICY_VERSION = "2026-10-v1";

export class ApiError extends Error {
  constructor(message: string, public status = 400, public extra?: Record<string, unknown>) { super(message); }
}

export function requirePermission(actor: Actor, permission: Permission) {
  if (!can(actor.role, permission)) throw new ApiError("This workspace is not authorised for that action", 403);
}
export function requireOrg(actor: Actor) {
  if (kindOf(actor.role) !== "client" || !actor.orgId) throw new ApiError("An active client organisation membership is required", 403);
  return actor.orgId;
}

export async function runBatch(db: Db, stmts: Stmt[]) {
  if (stmts.length) await db.batch(stmts as [Stmt, ...Stmt[]]);
}

export const auditStmt = (db: Db, actorId: string, action: string, resource: string, detail = "") =>
  db.insert(auditEvents).values({ id: uid("AUD"), actorId, action, resource, detail });
export const notifyStmt = (db: Db, userId: string, event: string, message: string) =>
  db.insert(notifications).values({ id: uid("NOT"), userId, event, message });

export async function usersWithRole(db: Db, roles: Role[]) {
  const rows = await db.select({ userId: memberships.userId }).from(memberships).where(and(inArray(memberships.role, roles), eq(memberships.status, "active")));
  return [...new Set(rows.map(r => r.userId))];
}
