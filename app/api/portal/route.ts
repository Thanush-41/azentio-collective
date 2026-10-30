import { getDb } from "@/db";
import { errorResponse, requirePortalSession } from "@/lib/portal-auth";
import * as s from "@/lib/domain/schemas";
import { ApiError } from "@/lib/services/core";
import { inviteMember, listOrgMembers, revokeInvitation, revokeMembership } from "@/lib/services/identity";
import * as obs from "@/lib/services/observations";
import * as learn from "@/lib/services/learning";
import * as imp from "@/lib/services/improvements";
import * as adm from "@/lib/services/admin";
import { moderationAssist } from "@/lib/services/assist";
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
      case "moderation_assist": return Response.json(await moderationAssist(db, actor, q("id") ?? ""));
      case "learning": return Response.json(await learn.getLearning(db, actor, { offering: q("offering"), industry: q("industry"), region: q("region"), period: q("period"), topic: q("topic") }));
      case "entitlements": return Response.json({ products: await learn.listEntitlements(db, actor) });
      case "improvements": return Response.json({ improvements: await imp.listImprovements(db, actor) });
      case "notifications": return Response.json(await imp.listNotifications(db, actor));
      case "members": return Response.json(await listOrgMembers(db, actor));
      case "themes": return Response.json({ themes: await adm.listThemesAdmin(db, actor) });
      case "entitlement_matrix": return Response.json(await adm.entitlementMatrix(db, actor));
      case "support_grants": return Response.json({ grants: await adm.listSupportGrants(db, actor) });
      case "content": return Response.json({ items: await adm.listContent(db, actor, q("q")) });
      case "audit": return Response.json({ events: await adm.listAudit(db, actor) });
      case "support": return Response.json({ requests: await adm.listSupportRequests(db, actor) });
      case "bookmarks": return Response.json({ bookmarks: await adm.listBookmarks(db, actor) });
      case "comments": return Response.json({ comments: await adm.listComments(db, actor, q("id") ?? "") });
      case "experiments": return Response.json({ experiments: await adm.listExperiments(db, actor) });
      case "teams": return Response.json({ teams: await adm.listTeams(db, actor) });
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
      case "seed_moderation_scenario": return Response.json(await learn.seedModerationScenario(db, actor));
      case "sandbox_run": return Response.json(await learn.runSandbox(db, actor, s.sandboxSchema.parse(rest)));
      case "aira": { const i = s.airaSchema.parse(rest); return Response.json(await learn.askAira(db, actor, i.question, i.filters)); }
      case "create_improvement": return Response.json(await imp.createImprovement(db, actor, s.improvementSchema.parse(rest)), { status: 201 });
      case "improvement_status": return Response.json(await imp.updateImprovementStatus(db, actor, s.improvementStatusSchema.parse(rest)));
      case "mark_read": return Response.json(await imp.markRead(db, actor, s.markReadSchema.parse(rest).ids));
      case "invite_member": return Response.json(await inviteMember(db, actor, s.inviteSchema.parse(rest)), { status: 201 });
      case "revoke_invitation": return Response.json(await revokeInvitation(db, actor, s.revokeInviteSchema.parse(rest).invitationId));
      case "revoke_membership": return Response.json(await revokeMembership(db, actor, s.revokeSchema.parse(rest).membershipId));
      case "create_theme": return Response.json(await adm.createTheme(db, actor, s.themeSchema.parse(rest)), { status: 201 });
      case "link_evidence": { const i = s.linkEvidenceSchema.parse(rest); return Response.json(await adm.linkEvidence(db, actor, i.themeId, i.publicationId)); }
      case "set_entitlement": { const i = s.entitlementSchema.parse(rest); return Response.json(await learn.setEntitlement(db, actor, i.orgId, i.productId, i.enabled)); }
      case "grant_support": return Response.json(await adm.grantSupportAccess(db, actor, s.supportGrantSchema.parse(rest)), { status: 201 });
      case "revoke_support": return Response.json(await adm.revokeSupportAccess(db, actor, s.idSchema.parse(rest).id));
      case "create_content": { const { publish, ...i } = s.contentSchema.parse(rest); return Response.json(await adm.createContent(db, actor, i, publish), { status: 201 }); }
      case "content_status": { const i = s.contentStatusSchema.parse(rest); return Response.json(await adm.setContentStatus(db, actor, i.id, i.status)); }
      case "add_bookmark": return Response.json(await adm.addBookmark(db, actor, s.bookmarkSchema.parse(rest)), { status: 201 });
      case "remove_bookmark": return Response.json(await adm.removeBookmark(db, actor, s.idSchema.parse(rest).id));
      case "add_comment": { const i = s.commentSchema.parse(rest); return Response.json(await adm.addComment(db, actor, i.publicationId, i.body), { status: 201 }); }
      case "update_team": return Response.json(await adm.updateTeam(db, actor, s.teamUpdateSchema.parse(rest)));
      case "experiment_status": { const i = s.experimentStatusSchema.parse(rest); return Response.json(await adm.setExperimentStatus(db, actor, i.id, i.status)); }
      case "add_feedback": return Response.json(await adm.addFeedback(db, actor, s.feedbackSchema.parse(rest)));
      case "rename_bookmark": { const i = s.renameBookmarkSchema.parse(rest); return Response.json(await adm.renameBookmark(db, actor, i.id, i.label)); }
      case "create_support_request": return Response.json(await adm.createSupportRequest(db, actor, s.supportRequestSchema.parse(rest)), { status: 201 });
      case "reply_support": return Response.json(await adm.replySupportRequest(db, actor, s.supportReplySchema.parse(rest)));
      case "submit_experiment": return Response.json(await adm.submitExperiment(db, actor, s.experimentSchema.parse(rest)), { status: 201 });
      case "create_team": return Response.json(await adm.createTeam(db, actor, s.teamSchema.parse(rest)), { status: 201 });
      case "join_team": return Response.json(await adm.joinTeam(db, actor, s.joinTeamSchema.parse(rest).teamId));
      default: throw new ApiError("Unknown action", 400);
    }
  } catch (error) { return errorResponse(error); }
}

