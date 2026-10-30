CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `demo_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`persona` text NOT NULL,
	`org_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `enquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`company` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `improvement_ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`problem_statement` text NOT NULL,
	`offering` text NOT NULL,
	`proposed_outcome` text NOT NULL,
	`owner` text NOT NULL,
	`priority` text NOT NULL,
	`status` text DEFAULT 'Under review' NOT NULL,
	`evidence_ids` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `moderation_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event` text NOT NULL,
	`message` text NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`author_id` text NOT NULL,
	`offering` text NOT NULL,
	`title` text NOT NULL,
	`industry` text NOT NULL,
	`region` text NOT NULL,
	`observation_period` text NOT NULL,
	`evidence_type` text NOT NULL,
	`confidence` text NOT NULL,
	`description` text NOT NULL,
	`sharing_intent` text DEFAULT 'private' NOT NULL,
	`allow_attribution` integer DEFAULT false NOT NULL,
	`allow_model_training` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shared_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`approved_text` text NOT NULL,
	`offering` text NOT NULL,
	`industry` text NOT NULL,
	`region` text NOT NULL,
	`observation_period` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`published_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_source_idx` ON `shared_publications` (`source_id`);