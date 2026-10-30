import { getDb } from "@/db";
import { currentIdentity, errorResponse, requirePortalSession } from "@/lib/portal-auth";
import { playerFor } from "@/lib/domain/media";
import { resolveMedia } from "@/lib/services/admin";

// Audience is checked on every request; the stored target URL is only revealed (via redirect) to permitted callers.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params, db = getDb();
    let actor = null;
    if (await currentIdentity()) actor = await requirePortalSession().catch(() => null);
    const url = await resolveMedia(db, actor, id);
    // ?format=json lets the page embed the recording; the audience check above has already passed.
    if (new URL(request.url).searchParams.get("format") === "json") return Response.json({ player: playerFor(url) }, { headers: { "Cache-Control": "private, no-store" } });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return errorResponse(error); }
}
