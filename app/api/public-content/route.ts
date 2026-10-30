import { getDb } from "@/db";
import { errorResponse } from "@/lib/portal-auth";
import { publicContent } from "@/lib/services/admin";

// Published, public-audience release notes and announcements only.
export async function GET() {
  try { return Response.json({ items: await publicContent(getDb()) }); } catch (error) { return errorResponse(error); }
}
