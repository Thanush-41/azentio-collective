import { z } from "zod";
import { industryField, offeringField, periodField, regionField } from "./taxonomy";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const observationFields = {
  offering: offeringField, title: text(3, 160), industry: industryField, region: regionField,
  observationPeriod: periodField, evidenceType: text(2, 120), confidence: z.enum(["Low", "Medium", "High"]),
  description: text(10, 3000), sharingIntent: z.enum(["private", "organization", "propose_community"]),
  processingConsent: z.boolean().default(false), allowAttribution: z.boolean().default(false), allowModelTraining: z.boolean().default(false),
};
export const createObservationSchema = z.object({ ...observationFields, submit: z.boolean().default(false), idempotencyKey: z.string().max(80).optional() }).strict();
export const updateObservationSchema = z.object({ observationId: text(3, 40), ...observationFields, submit: z.boolean().default(false) }).strict();
export const submitSchema = z.object({ observationId: text(3, 40), processingConsent: z.boolean().default(false), allowAttribution: z.boolean().optional() });
export const moderateSchema = z.object({
  observationId: text(3, 40), decision: z.enum(["publish", "clarify", "reject"]), reason: text(3, 500).default("Reviewed by moderator"),
  approvedText: text(10, 1200).optional(), themeId: text(3, 40).optional(), acknowledgeFlags: z.boolean().default(false),
  attribute: z.boolean().default(false),
  metadata: z.object({ offering: offeringField, industry: industryField, region: regionField, observationPeriod: periodField }).partial().optional(),
});
export const withdrawSchema = z.object({ observationId: text(3, 40) });
export const reportSchema = z.object({ publicationId: text(3, 40), reason: text(5, 500) });
export const resolveReportSchema = z.object({ reportId: text(3, 40), outcome: z.enum(["restore", "withdraw"]) });
export const improvementSchema = z.object({
  title: text(5, 180), problemStatement: text(10, 1000), proposedOutcome: text(10, 1000), owner: text(2, 120),
  priority: z.enum(["Low", "Medium", "High", "Critical"]), offering: offeringField.optional(), themeId: text(3, 40).optional(),
  evidenceIds: z.array(text(3, 40)).min(1).max(50),
});
export const improvementStatusSchema = z.object({
  improvementId: text(3, 40), status: z.enum(["Proposed", "Under review", "Planned", "In progress", "Released", "Not proceeding"]),
  internalNote: text(1, 1000).optional(), clientUpdate: text(1, 600).optional(),
});
export const acceptInviteSchema = z.object({ token: z.string().min(20).max(200) });
export const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(180), role: z.enum(["client_admin", "client_member"]) });
export const revokeInviteSchema = z.object({ invitationId: text(3, 60) });
export const revokeSchema = z.object({ membershipId: text(3, 60) });
export const markReadSchema = z.object({ ids: z.array(z.string()).max(100).optional() });
export const sandboxSchema = z.object({ offering: offeringField, cycle: text(2, 60), seasonality: z.number().min(0).max(100) });
export const airaSchema = z.object({
  question: text(5, 400),
  filters: z.object({ offering: z.string().max(120).optional(), industry: z.string().max(80).optional(), region: z.string().max(80).optional(),
    period: z.string().max(40).optional(), topic: z.string().max(120).optional() }).default({}),
});
export const publicFormSchema = z.object({
  kind: z.enum(["demo", "hackathon"]).default("demo"), name: text(1, 120), email: z.string().trim().email().max(180),
  company: text(1, 180), message: z.string().trim().max(1200).default(""), idempotencyKey: z.string().max(80).optional(),
});

export const themeSchema = z.object({ title: text(3, 120), topic: text(3, 160), offering: text(2, 120), summary: text(10, 600), suggestedImprovement: z.string().trim().max(300).default("") });
export const linkEvidenceSchema = z.object({ themeId: text(3, 40), publicationId: text(3, 40) });
export const entitlementSchema = z.object({ orgId: text(3, 60), productId: text(3, 60), enabled: z.boolean() });
export const supportGrantSchema = z.object({ email: z.string().trim().toLowerCase().email().max(180), hours: z.number().int().min(1).max(168) });
export const idSchema = z.object({ id: text(3, 60) });
export const contentSchema = z.object({ kind: z.enum(["broadcast", "release_note", "knowledge", "resource", "recording"]), audience: z.enum(["public", "client", "employee"]),
  orgId: text(3, 60).optional(), mediaUrl: z.string().trim().url().max(500).refine(u => u.startsWith("https://"), "Use an https link").optional(), title: text(3, 160), body: text(5, 4000), publish: z.boolean().default(false) })
  .refine(v => !v.mediaUrl || v.kind === "recording", { message: "A media link is only allowed on recordings", path: ["mediaUrl"] });
export const contentStatusSchema = z.object({ id: text(3, 60), status: z.enum(["published", "archived"]) });
export const bookmarkSchema = z.object({ kind: z.enum(["publication", "search"]), ref: text(1, 400), label: text(1, 120) });
export const commentSchema = z.object({ publicationId: text(3, 40), body: text(2, 800) });
export const experimentSchema = z.object({ title: text(3, 160), hypothesis: text(10, 1000) });
export const teamSchema = z.object({ name: text(2, 80), brief: z.string().trim().max(500).default("") });
export const joinTeamSchema = z.object({ teamId: text(3, 40) });
