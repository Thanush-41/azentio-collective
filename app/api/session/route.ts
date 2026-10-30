import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db";
import { currentIdentity, errorResponse, SESSION_COOKIE } from "@/lib/portal-auth";
import { ApiError } from "@/lib/services/core";
import { createSession, listMemberships, provisionOptionsFromEnv, provisionUser } from "@/lib/services/identity";

const bodySchema = z.object({ membershipId: z.string().min(3).max(200) }).strict();

// Lists the memberships the authenticated user actually holds.
export async function GET() {
  try {
    const identity = await currentIdentity();
    if (!identity) throw new ApiError("Sign in is required", 401);
    const db = getDb();
    await provisionUser(db, identity, provisionOptionsFromEnv(process.env));
    return Response.json({ memberships: await listMemberships(db, identity.userId) });
  } catch (error) { return errorResponse(error); }
}

// Accepts only a membership id; role and organisation are read from the verified membership row.
export async function POST(request: Request) {
  try {
    const identity = await currentIdentity();
    if (!identity) throw new ApiError("Sign in is required", 401);
    const { membershipId } = bodySchema.parse(await request.json());
    const { token, membership } = await createSession(getDb(), identity, membershipId);
    (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
    return Response.json({ membershipId: membership.id, role: membership.role, organization: membership.label, home: membership.home });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
