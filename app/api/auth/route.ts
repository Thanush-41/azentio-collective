import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db";
import { AUTH_COOKIE, errorResponse } from "@/lib/portal-auth";
import { ApiError } from "@/lib/services/core";
import { identityFromToken, issueVerificationCode, signIn, signOut, signUp, verifyEmailCode } from "@/lib/services/auth";
import { rateLimit } from "@/lib/services/public";

const schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("signup"), email: z.string().trim().email().max(180), password: z.string().min(10).max(200), name: z.string().trim().min(1).max(120) }),
  z.object({ mode: z.literal("verify"), code: z.string().regex(/^\d{6}$/) }),
  z.object({ mode: z.literal("resend") }),
  z.object({ mode: z.literal("signin"), email: z.string().trim().email().max(180), password: z.string().min(1).max(200) }),
]);

export async function POST(request: Request) {
  try {
    const db = getDb();
    const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
    await rateLimit(db, `auth:${ip}`, 10, 300);
    const body = schema.parse(await request.json());
    const jar = await cookies(), cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 7 * 86400 };
    if (body.mode === "verify" || body.mode === "resend") {
      const me = await identityFromToken(db, jar.get(AUTH_COOKIE)?.value ?? "");
      if (!me) throw new ApiError("Sign in is required", 401);
      if (body.mode === "verify") return Response.json(await verifyEmailCode(db, me.userId, body.code));
      const r = await issueVerificationCode(db, me.userId, me.email);
      return Response.json({ emailSent: r.emailSent, reason: r.reason });
    }
    const signup = body.mode === "signup" ? await signUp(db, body) : null;
    const r = signup ?? await signIn(db, body as { email: string; password: string });
    jar.set(AUTH_COOKIE, r.token, cookieOpts);
    const me = await identityFromToken(db, r.token);
    return Response.json({ email: r.email, emailVerified: me?.emailVerified ?? false, emailSent: signup?.verification.emailSent, reason: signup?.verification.reason });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE() {
  const jar = await cookies(), token = jar.get(AUTH_COOKIE)?.value;
  if (token) await signOut(getDb(), token);
  jar.delete(AUTH_COOKIE);
  return Response.json({ ok: true });
}
