import { getDb } from "@/db";
import { currentIdentity, errorResponse, requirePortalSession } from "@/lib/portal-auth";
import { resolveMedia } from "@/lib/services/admin";

// Audience is checked on every request; the stored target URL is only revealed (via redirect) to permitted callers.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params, db = getDb();
    let actor = null;
    if (await currentIdentity()) actor = await requirePortalSession().catch(() => null);
    const url = await resolveMedia(db, actor, id);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return errorResponse(error); }
}
