// Applies drizzle/*.sql to Turso/libSQL exactly once each. Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrate-libsql.mjs
import { createClient } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL is required");
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
await db.execute("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
const done = new Set((await db.execute("SELECT name FROM _migrations")).rows.map(r => String(r.name)));
for (const file of readdirSync("drizzle").filter(f => f.endsWith(".sql")).sort()) {
  if (done.has(file)) { console.log(`skip ${file}`); continue; }
  const statements = readFileSync(`drizzle/${file}`, "utf8").split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
  await db.batch([...statements.map(sql => ({ sql, args: [] })), { sql: "INSERT INTO _migrations (name) VALUES (?)", args: [file] }], "write");
  console.log(`applied ${file}`);
}
