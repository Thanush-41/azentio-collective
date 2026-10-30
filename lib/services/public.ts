import { eq } from "drizzle-orm";
import { enquiries, idempotencyKeys, rateLimits } from "@/db/schema";
import { ApiError, type Db, uid } from "./core";

/** Fixed-window counter persisted in D1. Throws 429 when the window budget is exhausted. */
export async function rateLimit(db: Db, key: string, limit: number, windowSeconds: number, nowMs = Date.now()) {
  const window = Math.floor(nowMs / (windowSeconds * 1000));
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);
  if (!row || row.windowStart !== window) {
    await db.insert(rateLimits).values({ key, windowStart: window, count: 1 }).onConflictDoUpdate({ target: rateLimits.key, set: { windowStart: window, count: 1 } });
    return;
  }
  if (row.count >= limit) throw new ApiError("Too many requests. Please try again shortly.", 429);
  await db.update(rateLimits).set({ count: row.count + 1 }).where(eq(rateLimits.key, key));
}

export async function withIdempotency<T>(db: Db, key: string | undefined, scope: string, fn: () => Promise<T>): Promise<T> {
  if (!key) return fn();
  const k = `${scope}:${key}`;
  const [hit] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, k)).limit(1);
  if (hit) return JSON.parse(hit.response) as T;
  const result = await fn();
  await db.insert(idempotencyKeys).values({ key: k, response: JSON.stringify(result) }).onConflictDoNothing();
  return result;
}

export async function storeEnquiry(db: Db, input: { kind: "demo" | "hackathon"; name: string; email: string; company: string; message: string }) {
  const id = uid(input.kind === "hackathon" ? "REG" : "ENQ");
  await db.insert(enquiries).values({ id, ...input });
  return { reference: id, status: "stored", notification: "Your request has been recorded. No email delivery is claimed." };
}
