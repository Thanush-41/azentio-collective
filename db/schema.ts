import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
});

export const demoSessions = sqliteTable("demo_sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  persona: text("persona").notNull(),
  orgId: text("org_id"),
  membershipId: text("membership_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const observations = sqliteTable("observations", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull(), authorId: text("author_id").notNull(),
  offering: text("offering").notNull(), title: text("title").notNull(), industry: text("industry").notNull(),
  region: text("region").notNull(), observationPeriod: text("observation_period").notNull(),
  evidenceType: text("evidence_type").notNull(), confidence: text("confidence").notNull(),
  description: text("description").notNull(), sharingIntent: text("sharing_intent").notNull().default("private"),
  allowAttribution: integer("allow_attribution", { mode: "boolean" }).notNull().default(false),
  allowModelTraining: integer("allow_model_training", { mode: "boolean" }).notNull().default(false),
  privacyFlags: text("privacy_flags").notNull().default(""),
  status: text("status").notNull().default("draft"), version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const publications = sqliteTable("shared_publications", {
  id: text("id").primaryKey(), sourceId: text("source_id").notNull(), approvedText: text("approved_text").notNull(),
  offering: text("offering").notNull(), industry: text("industry").notNull(), region: text("region").notNull(),
  observationPeriod: text("observation_period").notNull(), version: integer("version").notNull().default(1),
  status: text("status").notNull().default("published"), publishedAt: text("published_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("publications_source_idx").on(table.sourceId)]);

export const moderationReviews = sqliteTable("moderation_reviews", {
  id: text("id").primaryKey(), observationId: text("observation_id").notNull(), moderatorId: text("moderator_id").notNull(),
  decision: text("decision").notNull(), reason: text("reason").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const improvements = sqliteTable("improvement_ideas", {
  id: text("id").primaryKey(), title: text("title").notNull(), problemStatement: text("problem_statement").notNull(),
  offering: text("offering").notNull(), proposedOutcome: text("proposed_outcome").notNull(), owner: text("owner").notNull(),
  priority: text("priority").notNull(), status: text("status").notNull().default("Under review"),
  evidenceIds: text("evidence_ids").notNull(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const enquiries = sqliteTable("enquiries", {
  id: text("id").primaryKey(), kind: text("kind").notNull(), name: text("name").notNull(), email: text("email").notNull(),
  company: text("company").notNull(), message: text("message").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), event: text("event").notNull(), message: text("message").notNull(),
  readAt: text("read_at"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(), actorId: text("actor_id").notNull(), action: text("action").notNull(),
  resource: text("resource").notNull(), detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(), email: text("email").notNull(), displayName: text("display_name").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// role: client_admin | client_member | moderator | product_owner | employee. orgId is required for client roles only.
export const memberships = sqliteTable("memberships", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), orgId: text("org_id"), role: text("role").notNull(),
  label: text("label").notNull(), status: text("status").notNull().default("active"), grantedBy: text("granted_by").notNull().default("system"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("memberships_user_org_role_idx").on(table.userId, table.orgId, table.role)]);

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull(), email: text("email").notNull(), role: text("role").notNull(),
  status: text("status").notNull().default("pending"), invitedBy: text("invited_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Append-only consent history. type: processing | community_sharing | attribution | model_training.
export const consents = sqliteTable("consents", {
  id: text("id").primaryKey(), observationId: text("observation_id").notNull(), type: text("type").notNull(),
  state: text("state").notNull(), policyVersion: text("policy_version").notNull(), actorId: text("actor_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const products = sqliteTable("products", {
  id: text("id").primaryKey(), name: text("name").notNull(), code: text("code").notNull(),
});

export const entitlements = sqliteTable("entitlements", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull(), productId: text("product_id").notNull(),
  status: text("status").notNull().default("enabled"),
}, (table) => [uniqueIndex("entitlements_org_product_idx").on(table.orgId, table.productId)]);

export const themes = sqliteTable("themes", {
  id: text("id").primaryKey(), title: text("title").notNull(), topic: text("topic").notNull(), offering: text("offering").notNull(),
  summary: text("summary").notNull(), suggestedImprovement: text("suggested_improvement").notNull().default(""),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const themeEvidence = sqliteTable("theme_evidence", {
  themeId: text("theme_id").notNull(), publicationId: text("publication_id").notNull(),
}, (table) => [uniqueIndex("theme_evidence_idx").on(table.themeId, table.publicationId)]);

export const improvementEvidence = sqliteTable("improvement_evidence", {
  improvementId: text("improvement_id").notNull(), publicationId: text("publication_id").notNull(),
}, (table) => [uniqueIndex("improvement_evidence_idx").on(table.improvementId, table.publicationId)]);

// audience: internal | client
export const improvementUpdates = sqliteTable("improvement_updates", {
  id: text("id").primaryKey(), improvementId: text("improvement_id").notNull(), audience: text("audience").notNull(),
  body: text("body").notNull(), authorId: text("author_id").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const publicationReports = sqliteTable("publication_reports", {
  id: text("id").primaryKey(), publicationId: text("publication_id").notNull(), reporterId: text("reporter_id").notNull(),
  reason: text("reason").notNull(), status: text("status").notNull().default("open"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  key: text("key").primaryKey(), response: text("response").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(), windowStart: integer("window_start").notNull(), count: integer("count").notNull().default(0),
});

// Client-granted, time-boxed authorisation for Azentio moderation/support staff to read non-private org records.
export const supportGrants = sqliteTable("support_grants", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull(), granteeUserId: text("grantee_user_id").notNull(),
  status: text("status").notNull().default("active"), expiresAt: text("expires_at").notNull(), grantedBy: text("granted_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// kind: broadcast | release_note | knowledge | resource. audience: public | client | employee.
export const contentItems = sqliteTable("content_items", {
  id: text("id").primaryKey(), kind: text("kind").notNull(), audience: text("audience").notNull(), orgId: text("org_id"),
  title: text("title").notNull(), body: text("body").notNull(), status: text("status").notNull().default("draft"), authorId: text("author_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// kind: publication | search
export const bookmarks = sqliteTable("bookmarks", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), kind: text("kind").notNull(), ref: text("ref").notNull(), label: text("label").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(), publicationId: text("publication_id").notNull(), authorId: text("author_id").notNull(), authorLabel: text("author_label").notNull(),
  body: text("body").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const experiments = sqliteTable("experiments", {
  id: text("id").primaryKey(), title: text("title").notNull(), hypothesis: text("hypothesis").notNull(), status: text("status").notNull().default("proposed"),
  authorId: text("author_id").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(), name: text("name").notNull(), brief: text("brief").notNull().default(""), ownerId: text("owner_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const teamMembers = sqliteTable("team_members", {
  teamId: text("team_id").notNull(), userId: text("user_id").notNull(), label: text("label").notNull(),
}, (table) => [uniqueIndex("team_members_idx").on(table.teamId, table.userId)]);
