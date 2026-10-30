import { and, eq, gt } from "drizzle-orm";
import { authSessions, credentials, profiles } from "@/db/schema";
import { ApiError, type Db } from "./core";

const ITERATIONS = 100_000; // Workers' WebCrypto cap
const enc = new TextEncoder();
const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => new Uint8Array(h.match(/../g)?.map(x => parseInt(x, 16)) ?? []);

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

export async function signUp(db: Db, i: { email: string; password: string; name: string }) {
  const email = i.email.toLowerCase();
  const [existing] = await db.select().from(credentials).where(eq(credentials.email, email)).limit(1);
  // Same response shape as a failed sign-in, so accounts cannot be enumerated.
  if (existing) throw new ApiError("An account with this email may already exist. Try signing in.", 409);
  const userId = `usr-${crypto.randomUUID()}`, salt = crypto.getRandomValues(new Uint8Array(16));
  await db.insert(credentials).values({ userId, email, salt: toHex(salt), hash: await hashPassword(i.password, salt) });
  await db.insert(profiles).values({ userId, email, displayName: i.name }).onConflictDoNothing();
  return { token: await newSession(db, userId), userId, email };
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
  return p ? { userId: p.userId, email: p.email, displayName: p.displayName, fullName: p.displayName } : null;
}

export async function signOut(db: Db, token: string) { await db.delete(authSessions).where(eq(authSessions.token, token)); }
