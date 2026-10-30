import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // On Vercel there is no Cloudflare runtime; the database comes from Turso via TURSO_DATABASE_URL.
  ...(process.env.VERCEL ? { turbopack: { resolveAlias: { "cloudflare:workers": "./db/cloudflare-stub.ts" } } } : {}),
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;
