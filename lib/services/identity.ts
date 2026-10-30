import { and, eq, isNull } from "drizzle-orm";
import { credentials, demoSessions, entitlements, invitations, memberships, organizations, products, profiles } from "@/db/schema";
import { homeFor, kindOf, ROLES, type Role } from "@/lib/domain/rbac";
import { sha256 } from "./auth";
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
/** Deny by default: demo tenants and staff roles are opt-in, and in production staff roles also need a verified email. */
export function provisionOptionsFromEnv(env: Record<string, string | undefined>): ProvisionOptions {
  const dev = env.NODE_ENV !== "production";
  return {
    staffEmails: (env.PORTAL_STAFF_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
    openDemoClients: env.DEMO_OPEN_CLIENT_TENANTS === "1" || (dev && env.DEMO_OPEN_CLIENT_TENANTS !== "0"),
    openDemoStaff: dev && env.DEMO_OPEN_STAFF !== "0",
  };
}

const memberId = (userId: string, orgId: string | null, role: string) => `${userId}:${orgId ?? "-"}:${role}`;

/** Reference data + the memberships a user is entitled to. Privileged roles are never self-selectable and need a verified email. */
export async function provisionUser(db: Db, identity: { userId: string; email: string; displayName?: string; emailVerified?: boolean }, opts: ProvisionOptions) {
  const email = identity.email.toLowerCase();
  const stmts: Stmt[] = [
    db.insert(profiles).values({ userId: identity.userId, email, displayName: identity.displayName ?? "" }).onConflictDoNothing(),
    db.insert(organizations).values(DEMO_ORGS).onConflictDoNothing(),
    db.insert(products).values(PRODUCTS).onConflictDoNothing(),
    db.insert(entitlements).values(DEMO_ENTITLEMENTS.map(([orgId, productId]) => ({ id: `ENT-${orgId}-${productId}`, orgId, productId }))).onConflictDoNothing(),
  ];
  const grants: { orgId: string | null; role: Role; label: string; by: string }[] = [];
  const demoClients = [{ orgId: "org-meridian", role: "client_admin" as Role, label: "Meridian Bank", by: "demo-provisioning" },
    { orgId: "org-northstar", role: "client_member" as Role, label: "Northstar Finance", by: "demo-provisioning" },
    { orgId: "org-harbour", role: "client_member" as Role, label: "Harbour Credit Union", by: "demo-provisioning" }];
  const approvedStaff = opts.staffEmails.includes(email) && identity.emailVerified === true;
  if (opts.openDemoClients) grants.push(...demoClients);
  if (opts.openDemoStaff || approvedStaff) {
    grants.push({ orgId: null, role: "moderator", label: "Learning Moderator", by: "staff-allowlist" }, { orgId: null, role: "product_owner", label: "Product Owner", by: "staff-allowlist" },
      { orgId: null, role: "employee", label: "Azentio Employee", by: "staff-allowlist" }, { orgId: null, role: "content_publisher", label: "Content Publisher", by: "staff-allowlist" });
    // Approved staff may also exercise the synthetic demo tenants to demonstrate tenant isolation.
    if (approvedStaff && !opts.openDemoClients) grants.push(...demoClients.map(g => ({ ...g, by: "staff-demo" })));
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
  return { members: rows.map(r => ({ id: r.id, email: email.get(r.userId) ?? "", role: r.role, status: r.status })), invitations: invites.map(i => ({ id: i.id, email: i.email, role: i.role, status: i.status === "pending" && i.expiresAt && i.expiresAt < new Date().toISOString() ? "expired" : i.status })) };
}

const INVITE_TTL_MS = 7 * 86400_000;

/** Creates a single-use, expiring invitation. The token is returned once and stored only as a hash. */
export async function inviteMember(db: Db, actor: Actor, input: { email: string; role: Role }) {
  if (actor.role !== "client_admin" || !actor.orgId) throw new ApiError("Client administrator access required", 403);
  // Client administrators can only grant client roles — never employee, moderator, product-owner or platform roles.
  if (!["client_admin", "client_member"].includes(input.role)) throw new ApiError("Role cannot be assigned by a client administrator", 403);
  const id = uid("INV"), token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  await runBatch(db, [db.insert(invitations).values({ id, orgId: actor.orgId, email: input.email, role: input.role, invitedBy: actor.userId, tokenHash: await sha256(token), expiresAt }),
    auditStmt(db, actor.userId, "invite_member", id, `${input.role}`)]);
  return { id, status: "pending", token, expiresAt, organization: DEMO_ORGS.find(o => o.id === actor.orgId)?.name ?? actor.orgId };
}

/** Accepts an invitation only for the intended signed-in account (matching email), once, before it expires. */
export async function acceptInvitation(db: Db, identity: { userId: string; email: string }, token: string) {
  const hash = await sha256(token);
  const [inv] = await db.select().from(invitations).where(eq(invitations.tokenHash, hash)).limit(1);
  if (!inv || inv.status !== "pending" || inv.expiresAt < new Date().toISOString()) throw new ApiError("This invitation is invalid, used, revoked or expired", 400);
  if (inv.email.toLowerCase() !== identity.email.toLowerCase()) throw new ApiError("This invitation was issued to a different email address", 403);
  const org = DEMO_ORGS.find(o => o.id === inv.orgId);
  await runBatch(db, [
    db.insert(memberships).values({ id: memberId(identity.userId, inv.orgId, inv.role), userId: identity.userId, orgId: inv.orgId, role: inv.role, label: org?.name ?? inv.orgId, grantedBy: inv.invitedBy }).onConflictDoNothing(),
    db.update(invitations).set({ status: "accepted" }).where(eq(invitations.id, inv.id)),
    // The single-use token was delivered to this address by the organisation's administrator, which proves control of it for client roles.
    db.update(credentials).set({ emailVerifiedAt: new Date().toISOString() }).where(and(eq(credentials.userId, identity.userId), isNull(credentials.emailVerifiedAt))),
    auditStmt(db, identity.userId, "accept_invitation", inv.id, inv.role)]);
  return { organization: org?.name ?? inv.orgId, role: inv.role };
}

export async function revokeInvitation(db: Db, actor: Actor, invitationId: string) {
  if (actor.role !== "client_admin" || !actor.orgId) throw new ApiError("Client administrator access required", 403);
  const [inv] = await db.select().from(invitations).where(eq(invitations.id, invitationId)).limit(1);
  if (!inv || inv.orgId !== actor.orgId) throw new ApiError("Invitation not found in this organisation", 404);
  if (inv.status !== "pending") throw new ApiError(`A ${inv.status} invitation cannot be revoked`, 409);
  await runBatch(db, [db.update(invitations).set({ status: "revoked" }).where(eq(invitations.id, inv.id)), auditStmt(db, actor.userId, "revoke_invitation", inv.id)]);
  return { id: inv.id, status: "revoked" };
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
