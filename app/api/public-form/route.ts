import { getDb } from "@/db";
import { errorResponse } from "@/lib/portal-auth";
import { publicFormSchema } from "@/lib/domain/schemas";
import { rateLimit, storeEnquiry, withIdempotency } from "@/lib/services/public";

export async function POST(request: Request) {
  try {
    const db = getDb();
    const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
    await rateLimit(db, `public-form:${ip}`, 5, 600);
    const { idempotencyKey, ...input } = publicFormSchema.parse(await request.json());
    const result = await withIdempotency(db, idempotencyKey, "public-form", () => storeEnquiry(db, input));
    return Response.json(result, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
