// Identifies the running build so a deployment can be matched to a Git commit.
export async function GET() {
  return Response.json({ commit: process.env.APP_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown", deployedAt: process.env.APP_BUILT_AT ?? null });
}
