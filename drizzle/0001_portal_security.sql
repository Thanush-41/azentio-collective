CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`type` text NOT NULL,
	`state` text NOT NULL,
	`policy_version` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`product_id` text NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entitlements_org_product_idx` ON `entitlements` (`org_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`response` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `improvement_evidence` (
	`improvement_id` text NOT NULL,
	`publication_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `improvement_evidence_idx` ON `improvement_evidence` (`improvement_id`,`publication_id`);--> statement-breakpoint
CREATE TABLE `improvement_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`improvement_id` text NOT NULL,
	`audience` text NOT NULL,
	`body` text NOT NULL,
	`author_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`org_id` text,
	`role` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`granted_by` text DEFAULT 'system' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_user_org_role_idx` ON `memberships` (`user_id`,`org_id`,`role`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `publication_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `theme_evidence` (
	`theme_id` text NOT NULL,
	`publication_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `theme_evidence_idx` ON `theme_evidence` (`theme_id`,`publication_id`);--> statement-breakpoint
CREATE TABLE `themes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`topic` text NOT NULL,
	`offering` text NOT NULL,
	`summary` text NOT NULL,
	`suggested_improvement` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `demo_sessions` ADD `membership_id` text;--> statement-breakpoint
ALTER TABLE `observations` ADD `privacy_flags` text DEFAULT '' NOT NULL;