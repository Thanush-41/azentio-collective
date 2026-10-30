import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db";
import { AUTH_COOKIE, errorResponse } from "@/lib/portal-auth";
import { signIn, signOut, signUp } from "@/lib/services/auth";
import { rateLimit } from "@/lib/services/public";

const schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("signup"), email: z.string().trim().email().max(180), password: z.string().min(10).max(200), name: z.string().trim().min(1).max(120) }),
  z.object({ mode: z.literal("signin"), email: z.string().trim().email().max(180), password: z.string().min(1).max(200) }),
]);

export async function POST(request: Request) {
  try {
    const db = getDb();
    const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
    await rateLimit(db, `auth:${ip}`, 10, 300);
    const body = schema.parse(await request.json());
    const r = body.mode === "signup" ? await signUp(db, body) : await signIn(db, body);
    (await cookies()).set(AUTH_COOKIE, r.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 7 * 86400 });
    return Response.json({ email: r.email });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE() {
  const jar = await cookies(), token = jar.get(AUTH_COOKIE)?.value;
  if (token) await signOut(getDb(), token);
  jar.delete(AUTH_COOKIE);
  return Response.json({ ok: true });
}
