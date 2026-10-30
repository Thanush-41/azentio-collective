import { and, eq } from "drizzle-orm";
import { demoSessions, entitlements, invitations, memberships, organizations, products, profiles } from "@/db/schema";
import { homeFor, kindOf, ROLES, type Role } from "@/lib/domain/rbac";
import { ApiError, type Actor, type Db, auditStmt, runBatch, uid, type Stmt } from "./core";

export const DEMO_ORGS = [
  { id: "org-meridian", name: "Meridian Bank" }, { id: "org-northstar", name: "Northstar Finance" }, { id: "org-harbour", name: "Harbour Credit Union" },
];
export const PRODUCTS = [
  { id: "prod-fai", name: "Financial Analysis Intelligence", code: "FAI" }, { id: "prod-lnd", name: "Lending Intelligence", code: "LND" },
  { id: "prod-cmp", name: "Compliance Intelligence", code: "CMP" },
];
const DEMO_ENTITLEMENTS: [string, string][] = [["org-meridian", "prod-fai"], ["org-meridian", "prod-lnd"], ["org-northstar", "prod-fai"], ["org-harbour", "prod-cmp"]];

export type ProvisionOptions = { staffEmails: string[]; openDemoClients: boolean; openDemoStaff: boolean };
export function provisionOptionsFromEnv(env: Record<string, string | undefined>): ProvisionOptions {
  const dev = env.NODE_ENV !== "production";
  return {
    staffEmails: (env.PORTAL_STAFF_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
    openDemoClients: (env.DEMO_OPEN_CLIENT_TENANTS ?? "1") === "1",
    openDemoStaff: dev && env.DEMO_OPEN_STAFF !== "0",
  };
}

const memberId = (userId: string, orgId: string | null, role: string) => `${userId}:${orgId ?? "-"}:${role}`;

/** Reference data + the memberships a user is entitled to. Privileged roles are never self-selectable. */
export async function provisionUser(db: Db, identity: { userId: string; email: string; displayName?: string }, opts: ProvisionOptions) {
  const email = identity.email.toLowerCase();
  const stmts: Stmt[] = [
    db.insert(profiles).values({ userId: identity.userId, email, displayName: identity.displayName ?? "" }).onConflictDoNothing(),
    db.insert(organizations).values(DEMO_ORGS).onConflictDoNothing(),
    db.insert(products).values(PRODUCTS).onConflictDoNothing(),
    db.insert(entitlements).values(DEMO_ENTITLEMENTS.map(([orgId, productId]) => ({ id: `ENT-${orgId}-${productId}`, orgId, productId }))).onConflictDoNothing(),
  ];
  const grants: { orgId: string | null; role: Role; label: string; by: string }[] = [];
  if (opts.openDemoClients) grants.push({ orgId: "org-meridian", role: "client_admin", label: "Meridian Bank", by: "demo-provisioning" },
    { orgId: "org-northstar", role: "client_member", label: "Northstar Finance", by: "demo-provisioning" });
  if (opts.openDemoStaff || opts.staffEmails.includes(email)) grants.push(
    { orgId: null, role: "moderator", label: "Learning Moderator", by: "staff-allowlist" }, { orgId: null, role: "product_owner", label: "Product Owner", by: "staff-allowlist" },
    { orgId: null, role: "employee", label: "Azentio Employee", by: "staff-allowlist" });
  const pending = await db.select().from(invitations).where(and(eq(invitations.email, email), eq(invitations.status, "pending")));
  for (const inv of pending) {
    const org = DEMO_ORGS.find(o => o.id === inv.orgId);
    grants.push({ orgId: inv.orgId, role: inv.role as Role, label: org?.name ?? inv.orgId, by: inv.invitedBy });
    stmts.push(db.update(invitations).set({ status: "accepted" }).where(eq(invitations.id, inv.id)));
  }
  for (const g of grants) stmts.push(db.insert(memberships).values({ id: memberId(identity.userId, g.orgId, g.role), userId: identity.userId, orgId: g.orgId, role: g.role, label: g.label, grantedBy: g.by }).onConflictDoNothing());
  await runBatch(db, stmts);
}

export async function listMemberships(db: Db, userId: string) {
  const rows = await db.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.status, "active")));
  return rows.filter(r => (ROLES as readonly string[]).includes(r.role)).map(r => ({ id: r.id, role: r.role as Role, kind: kindOf(r.role as Role), orgId: r.orgId, label: r.label, home: homeFor(r.role as Role) }));
}

/** Creates a session bound to an active membership owned by the authenticated user; role/org come from the membership row. */
export async function createSession(db: Db, identity: { userId: string; email: string }, membershipId: string) {
  const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1);
  if (!m || m.userId !== identity.userId || m.status !== "active") throw new ApiError("Membership not available to this user", 403);
  const token = crypto.randomUUID();
  await db.insert(demoSessions).values({ token, userId: identity.userId, email: identity.email, persona: m.role, orgId: m.orgId, membershipId: m.id });
  return { token, membership: { id: m.id, role: m.role as Role, orgId: m.orgId, label: m.label, home: homeFor(m.role as Role) } };
}

export async function resolveSession(db: Db, userId: string, email: string, token: string): Promise<Actor> {
  const [s] = await db.select().from(demoSessions).where(and(eq(demoSessions.token, token), eq(demoSessions.userId, userId))).limit(1);
  if (!s?.membershipId) throw new ApiError("Session expired", 401);
  const [m] = await db.select().from(memberships).where(eq(memberships.id, s.membershipId)).limit(1);
  // Revoking a membership takes effect on the next request.
  if (!m || m.userId !== userId || m.status !== "active") throw new ApiError("Membership is no longer active", 403);
  return { userId, email, membershipId: m.id, role: m.role as Role, orgId: m.orgId, label: m.label };
}

export async function listOrgMembers(db: Db, actor: Actor) {
  if (actor.role !== "client_admin" || !actor.orgId) throw new ApiError("Client administrator access required", 403);
  const rows = await db.select({ id: memberships.id, userId: memberships.userId, role: memberships.role, status: memberships.status }).from(memberships).where(eq(memberships.orgId, actor.orgId));
  const invites = await db.select().from(invitations).where(eq(invitations.orgId, actor.orgId));
  const profs = await db.select().from(profiles);
  const email = new Map(profs.map(p => [p.userId, p.email]));
  return { members: rows.map(r => ({ id: r.id, email: email.get(r.userId) ?? "", role: r.role, status: r.status })), invitations: invites.map(i => ({ id: i.id, email: i.email, role: i.role, status: i.status })) };
}

export async function inviteMember(db: Db, actor: Actor, input: { email: string; role: Role }) {
  if (actor.role !== "client_admin" || !actor.orgId) throw new ApiError("Client administrator access required", 403);
  // Client administrators can only grant client roles — never employee, moderator, product-owner or platform roles.
  if (!["client_admin", "client_member"].includes(input.role)) throw new ApiError("Role cannot be assigned by a client administrator", 403);
  const id = uid("INV");
  await runBatch(db, [db.insert(invitations).values({ id, orgId: actor.orgId, email: input.email, role: input.role, invitedBy: actor.userId }), auditStmt(db, actor.userId, "invite_member", id, `${input.role}`)]);
  return { id, status: "pending" };
}

export async function revokeMembership(db: Db, actor: Actor, membershipId: string) {
  if (actor.role !== "client_admin" || !actor.orgId) throw new ApiError("Client administrator access required", 403);
  const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1);
  if (!m || m.orgId !== actor.orgId) throw new ApiError("Membership not found in this organisation", 404);
  if (m.userId === actor.userId) throw new ApiError("Administrators cannot revoke their own membership", 409);
  await runBatch(db, [db.update(memberships).set({ status: "revoked" }).where(eq(memberships.id, m.id)),
    db.delete(demoSessions).where(eq(demoSessions.membershipId, m.id)), auditStmt(db, actor.userId, "revoke_membership", m.id)]);
  return { id: m.id, status: "revoked" };
}
