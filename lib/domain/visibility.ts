import type { Role } from "./rbac";
import { kindOf } from "./rbac";

export type SharingIntent = "private" | "organization" | "propose_community";
export type Actor = { userId: string; role: Role; orgId: string | null };
export type ObservationLike = { orgId: string; authorId: string; sharingIntent: string; status: string };

/** Who can read a source observation. Private = author only; organization/community intent = org members. */
export function canReadObservation(actor: Actor, o: ObservationLike): boolean {
  if (kindOf(actor.role) === "client") {
    if (!actor.orgId || actor.orgId !== o.orgId) return false;
    return o.sharingIntent === "private" ? o.authorId === actor.userId : true;
  }
  if (actor.role === "moderator") return o.status === "submitted" && o.sharingIntent === "propose_community";
  return false;
}

/** Only community proposals may enter the moderation queue. */
export const isModerationEligible = (o: { status: string; sharingIntent: string }) => o.status === "submitted" && o.sharingIntent === "propose_community";
