CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`user_id` text NOT NULL,
	`rating` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_unique_idx` ON `feedback` (`kind`,`ref_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `support_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`author_id` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reply` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `content_items` ADD `owner` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `review_date` text;--> statement-breakpoint
ALTER TABLE `experiments` ADD `team_id` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `submission_url` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `progress` text DEFAULT '' NOT NULL;