export const ROLES = ["client_admin", "client_member", "moderator", "product_owner", "employee"] as const;
export type Role = (typeof ROLES)[number];
export type Kind = "client" | "moderator" | "product_owner" | "employee";

export const CLIENT_ROLES: Role[] = ["client_admin", "client_member"];
// Roles a client administrator may grant. Employee, moderator and platform roles are never client-assignable.
export const CLIENT_ASSIGNABLE_ROLES: Role[] = ["client_admin", "client_member"];

export const kindOf = (role: Role): Kind => (CLIENT_ROLES.includes(role) ? "client" : (role as Kind));

const PERMISSIONS = {
  "observation:write": ["client_admin", "client_member"],
  "org:view": ["client_admin", "client_member"],
  "members:manage": ["client_admin"],
  "sandbox:run": ["client_admin", "client_member", "employee", "product_owner"],
  "moderate": ["moderator"],
  "improvement:manage": ["product_owner"],
  "improvement:read_internal": ["product_owner", "employee"],
  "learning:read": ["client_admin", "client_member", "moderator", "product_owner", "employee"],
  "demo:seed": ["moderator", "product_owner"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export const can = (role: Role, permission: Permission) => (PERMISSIONS[permission] as readonly Role[]).includes(role);

export function homeFor(role: Role) {
  const kind = kindOf(role);
  return kind === "client" ? "/client/dashboard" : kind === "moderator" ? "/moderation" : kind === "product_owner" ? "/employee/ideas" : "/employee/dashboard";
}
