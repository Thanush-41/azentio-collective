import { getDb } from "@/db";
import { errorResponse, requirePortalSession } from "@/lib/portal-auth";
import * as s from "@/lib/domain/schemas";
import { ApiError } from "@/lib/services/core";
import { inviteMember, listOrgMembers, revokeMembership } from "@/lib/services/identity";
import * as obs from "@/lib/services/observations";
import * as learn from "@/lib/services/learning";
import * as imp from "@/lib/services/improvements";
import { withIdempotency } from "@/lib/services/public";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url), scope = url.searchParams.get("scope") ?? "session";
    const actor = await requirePortalSession(), db = getDb();
    const q = (k: string) => url.searchParams.get(k) || undefined;
    switch (scope) {
      case "session": return Response.json({ key: actor.membershipId, role: actor.kind, memberRole: actor.role, organization: actor.label, orgId: actor.orgId, email: actor.email });
      case "observations": return Response.json({ observations: await obs.listObservations(db, actor) });
      case "observation": return Response.json({ observation: await obs.getObservation(db, actor, q("id") ?? "") });
      case "consents": return Response.json({ consents: await obs.consentHistory(db, actor, q("id") ?? "") });
      case "reports": return Response.json({ reports: await obs.listReports(db, actor) });
      case "learning": return Response.json(await learn.getLearning(db, actor, { offering: q("offering"), industry: q("industry"), region: q("region"), period: q("period"), topic: q("topic") }));
      case "entitlements": return Response.json({ products: await learn.listEntitlements(db, actor) });
      case "improvements": return Response.json({ improvements: await imp.listImprovements(db, actor) });
      case "notifications": return Response.json(await imp.listNotifications(db, actor));
      case "members": return Response.json(await listOrgMembers(db, actor));
      default: throw new ApiError("Unknown scope", 400);
    }
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { action, ...rest } = body;
    const actor = await requirePortalSession(), db = getDb();
    switch (action) {
      case "create_observation": {
        const { submit, idempotencyKey, ...input } = s.createObservationSchema.parse(rest);
        return Response.json(await withIdempotency(db, idempotencyKey && `${actor.userId}:${idempotencyKey}`, "create_observation", () => obs.createObservation(db, actor, input, submit)), { status: 201 });
      }
      case "update_observation": { const { observationId, submit, ...input } = s.updateObservationSchema.parse(rest); return Response.json(await obs.updateObservation(db, actor, observationId, input, submit)); }
      case "submit": { const i = s.submitSchema.parse(rest); return Response.json(await obs.submitObservation(db, actor, i.observationId, i.processingConsent)); }
      case "moderate": return Response.json(await obs.moderate(db, actor, s.moderateSchema.parse(rest)));
      case "withdraw": return Response.json(await obs.withdraw(db, actor, s.withdrawSchema.parse(rest).observationId));
      case "report": { const i = s.reportSchema.parse(rest); return Response.json(await obs.reportPublication(db, actor, i.publicationId, i.reason), { status: 201 }); }
      case "resolve_report": { const i = s.resolveReportSchema.parse(rest); return Response.json(await obs.resolveReport(db, actor, i.reportId, i.outcome)); }
      case "seed_scenario": return Response.json(await learn.seedScenario(db, actor));
      case "sandbox_run": return Response.json(await learn.runSandbox(db, actor, s.sandboxSchema.parse(rest)));
      case "aira": { const i = s.airaSchema.parse(rest); return Response.json(await learn.askAira(db, actor, i.question, i.filters)); }
      case "create_improvement": return Response.json(await imp.createImprovement(db, actor, s.improvementSchema.parse(rest)), { status: 201 });
      case "improvement_status": return Response.json(await imp.updateImprovementStatus(db, actor, s.improvementStatusSchema.parse(rest)));
      case "mark_read": return Response.json(await imp.markRead(db, actor, s.markReadSchema.parse(rest).ids));
      case "invite_member": return Response.json(await inviteMember(db, actor, s.inviteSchema.parse(rest)), { status: 201 });
      case "revoke_membership": return Response.json(await revokeMembership(db, actor, s.revokeSchema.parse(rest).membershipId));
      default: throw new ApiError("Unknown action", 400);
    }
  } catch (error) { return errorResponse(error); }
}

