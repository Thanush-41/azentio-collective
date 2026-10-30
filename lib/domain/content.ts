import { kindOf, type Role } from "./rbac";

export type ContentLike = { audience: string; orgId: string | null; status: string; authorId: string };
export const CONTENT_KINDS = ["broadcast", "release_note", "knowledge", "resource"] as const;
export const CONTENT_AUDIENCES = ["public", "client", "employee"] as const;

/** Audience rules: employee content never reaches clients; client resources with an orgId are tenant-scoped. */
export function canReadContent(actor: { role: Role; orgId: string | null; userId: string }, item: ContentLike, isPublisher: boolean): boolean {
  if (item.status !== "published") return isPublisher && (item.authorId === actor.userId || actor.role === "product_owner");
  if (item.audience === "public") return true;
  const kind = kindOf(actor.role);
  if (item.audience === "employee") return kind !== "client";
  if (item.audience === "client") return kind === "client" ? !item.orgId || item.orgId === actor.orgId : isPublisher;
  return false;
}
