import { cookies } from "next/headers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { ApiError, type Actor } from "@/lib/services/core";
import { identityFromToken } from "@/lib/services/auth";
import { resolveSession } from "@/lib/services/identity";
import { kindOf } from "@/lib/domain/rbac";

export const SESSION_COOKIE = "az_demo_session";
export const AUTH_COOKIE = "az_auth";

export async function currentIdentity() {
  const identity = await getChatGPTUser();
  if (identity) return identity;
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (token) { const found = await identityFromToken(getDb(), token); if (found) return found; }
  // Local development only (no cookie, no platform header); never honoured in production.
  if (process.env.NODE_ENV !== "production") return { userId: "local-demo-user", email: "demo@local.test", displayName: "Local demo", fullName: "Local demo" };
  return null;
}

/** Resolves the caller from the authenticated identity + an opaque session bound to an active membership. */
export async function requirePortalSession(allowed?: string[]): Promise<Actor & { kind: ReturnType<typeof kindOf> }> {
  const identity = await currentIdentity();
  if (!identity) throw new ApiError("Sign in is required", 401);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) throw new ApiError("Select a workspace", 401);
  const actor = await resolveSession(getDb(), identity.userId, identity.email, token);
  if (allowed && !allowed.includes(actor.role) && !allowed.includes(kindOf(actor.role))) throw new ApiError("This workspace is not authorised", 403);
  return { ...actor, kind: kindOf(actor.role) };
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message, ...(error.extra ?? {}) }, { status: error.status });
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { path: (string | number)[]; message: string }[] }).issues;
    return Response.json({ error: "Validation failed", issues: issues.map(i => ({ field: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  if (error instanceof Error && "status" in error && typeof (error as { status: unknown }).status === "number") return Response.json({ error: error.message }, { status: (error as { status: number }).status });
  return Response.json({ error: "Unexpected error" }, { status: 500 });
}
