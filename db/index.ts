import { createClient } from "@libsql/client";
import { env } from "cloudflare:workers";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import * as schema from "./schema";
import type { Db } from "@/lib/services/core";

let libsql: Db | undefined;

/** Turso/libSQL when TURSO_DATABASE_URL is set (Vercel); otherwise the Cloudflare D1 binding `DB`. */
export function getDb(): Db {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    libsql ??= drizzleLibsql(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }), { schema }) as unknown as Db;
    return libsql;
  }
  if (!env.DB) {
    throw new Error("No database: set TURSO_DATABASE_URL (Vercel) or bind Cloudflare D1 as `DB`.");
  }
  return drizzleD1(env.DB, { schema });
}
