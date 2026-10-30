import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { authSessions, credentials, emailVerifications, profiles } from "@/db/schema";
import { ApiError, type Db } from "./core";
import { sendMail } from "./mailer";

const ITERATIONS = 100_000; // Workers' WebCrypto cap
const enc = new TextEncoder();
const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => new Uint8Array(h.match(/../g)?.map(x => parseInt(x, 16)) ?? []);
export const sha256 = async (v: string) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(v)));

export async function hashPassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS }, key, 256));
}
const safeEqual = (a: string, b: string) => a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

async function newSession(db: Db, userId: string) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await db.insert(authSessions).values({ token, userId, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() });
  return token;
}

/** Issues a fresh single-use 6-digit code (older codes are invalidated) and emails it. */
export async function issueVerificationCode(db: Db, userId: string, email: string, mail = sendMail) {
  const buf = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000, code = String(buf).padStart(6, "0");
  await db.update(emailVerifications).set({ consumedAt: new Date().toISOString() }).where(and(eq(emailVerifications.userId, userId)));
  await db.insert(emailVerifications).values({ id: `ver-${crypto.randomUUID()}`, userId, codeHash: await sha256(`${userId}:${code}`), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
  const sent = await mail(email, "Your Azentio Collective verification code", `Your verification code is ${code}. It expires in 15 minutes. If you did not request it, ignore this email.`);
  return { emailSent: sent.accepted, ...(sent.accepted ? {} : { reason: sent.reason }) };
}

export async function verifyEmailCode(db: Db, userId: string, code: string) {
  const [v] = await db.select().from(emailVerifications).where(and(eq(emailVerifications.userId, userId), isNull(emailVerifications.consumedAt))).orderBy(desc(emailVerifications.createdAt)).limit(1);
  if (!v || v.expiresAt < new Date().toISOString()) throw new ApiError("Verification code expired. Request a new one.", 400);
  if (v.attempts >= 5) throw new ApiError("Too many attempts. Request a new code.", 429);
  await db.update(emailVerifications).set({ attempts: v.attempts + 1 }).where(eq(emailVerifications.id, v.id));
  if (!safeEqual(await sha256(`${userId}:${code}`), v.codeHash)) throw new ApiError("Incorrect verification code", 400);
  const at = new Date().toISOString();
  await db.update(emailVerifications).set({ consumedAt: at }).where(eq(emailVerifications.id, v.id));
  await db.update(credentials).set({ emailVerifiedAt: at }).where(eq(credentials.userId, userId));
  return { verified: true };
}

/** Operator path when no email provider is configured: marks an existing account's email verified. */
export async function markEmailVerified(db: Db, email: string) {
  const r = await db.update(credentials).set({ emailVerifiedAt: new Date().toISOString() }).where(eq(credentials.email, email.toLowerCase())).returning({ userId: credentials.userId });
  return r.length > 0;
}

export async function signUp(db: Db, i: { email: string; password: string; name: string }, mail = sendMail) {
  const email = i.email.toLowerCase();
  const [existing] = await db.select().from(credentials).where(eq(credentials.email, email)).limit(1);
  if (existing) throw new ApiError("An account with this email may already exist. Try signing in.", 409);
  const userId = `usr-${crypto.randomUUID()}`, salt = crypto.getRandomValues(new Uint8Array(16));
  await db.insert(credentials).values({ userId, email, salt: toHex(salt), hash: await hashPassword(i.password, salt) });
  await db.insert(profiles).values({ userId, email, displayName: i.name }).onConflictDoNothing();
  const verification = await issueVerificationCode(db, userId, email, mail);
  return { token: await newSession(db, userId), userId, email, verification };
}

export async function signIn(db: Db, i: { email: string; password: string }) {
  const [c] = await db.select().from(credentials).where(eq(credentials.email, i.email.toLowerCase())).limit(1);
  const salt = c ? fromHex(c.salt) : crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(i.password, salt); // always hash, to keep timing uniform
  if (!c || !safeEqual(hash, c.hash)) throw new ApiError("Incorrect email or password", 401);
  return { token: await newSession(db, c.userId), userId: c.userId, email: c.email };
}

export async function identityFromToken(db: Db, token: string) {
  const [s] = await db.select().from(authSessions).where(and(eq(authSessions.token, token), gt(authSessions.expiresAt, new Date().toISOString()))).limit(1);
  if (!s) return null;
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, s.userId)).limit(1);
  const [c] = await db.select().from(credentials).where(eq(credentials.userId, s.userId)).limit(1);
  return p ? { userId: p.userId, email: p.email, displayName: p.displayName, fullName: p.displayName, emailVerified: !!c?.emailVerifiedAt } : null;
}

export async function signOut(db: Db, token: string) { await db.delete(authSessions).where(eq(authSessions.token, token)); }
