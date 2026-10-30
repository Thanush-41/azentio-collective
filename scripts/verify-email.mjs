// Operator tool: mark an existing account's email as verified when no email provider is configured.
// Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/verify-email.mjs person@example.com
import { createClient } from "@libsql/client";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !process.env.TURSO_DATABASE_URL) throw new Error("Usage: TURSO_DATABASE_URL=... node scripts/verify-email.mjs <email>");
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const r = await db.execute({ sql: "UPDATE credentials SET email_verified_at = ? WHERE email = ? AND email_verified_at IS NULL", args: [new Date().toISOString(), email] });
console.log(r.rowsAffected ? `verified ${email}` : `no unverified account found for ${email}`);
