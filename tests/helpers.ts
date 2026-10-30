import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as schema from "@/db/schema";
import type { Actor, Db } from "@/lib/services/core";
import { createSession, listMemberships, provisionUser, resolveSession, type ProvisionOptions } from "@/lib/services/identity";

/** In-memory SQLite with the real generated migrations applied; cast to the D1 drizzle type the services expect. */
export async function createTestDb(): Promise<Db> {
  const client = createClient({ url: ":memory:" });
  const dir = path.resolve(__dirname, "../drizzle");
  for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await client.execute(stmt);
  }
  return drizzle(client, { schema }) as unknown as Db;
}

export const OPEN: ProvisionOptions = { staffEmails: [], openDemoClients: true, openDemoStaff: true };
export const CLOSED: ProvisionOptions = { staffEmails: [], openDemoClients: false, openDemoStaff: false };

export async function signIn(db: Db, userId: string, role: string, orgId: string | null = null, opts = OPEN): Promise<Actor> {
  const identity = { userId, email: `${userId}@test.dev` };
  await provisionUser(db, identity, opts);
  const m = (await listMemberships(db, userId)).find(x => x.role === role && x.orgId === orgId);
  if (!m) throw new Error(`no ${role} membership for ${userId}`);
  const { token } = await createSession(db, identity, m.id);
  return resolveSession(db, userId, identity.email, token);
}

export const obsInput = (over: Record<string, unknown> = {}) => ({
  offering: "Financial Analysis Intelligence", title: "Seasonal SME cash-flow analysis", industry: "Banking", region: "India", observationPeriod: "2026-Q3",
  evidenceType: "Synthetic observation", confidence: "Medium", description: "Seasonal variation is not reflected in the analysis.",
  sharingIntent: "propose_community" as const, processingConsent: true, allowAttribution: false, allowModelTraining: false, ...over,
});
