CREATE TABLE `item_slug_redirects` (
	`old_slug` text PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_item_slug_redirects_item` ON `item_slug_redirects` (`item_id`);--> statement-breakpoint
CREATE TABLE `member_slug_redirects` (
	`old_slug` text PRIMARY KEY NOT NULL,
	`member_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_member_slug_redirects_member` ON `member_slug_redirects` (`member_id`);--> statement-breakpoint
ALTER TABLE `blocks` ADD `form_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_form_key_unique` ON `blocks` (`form_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_fixed_once` ON `blocks` (`type`) WHERE "blocks"."type" in ('hero', 'projects', 'team', 'contact');--> statement-breakpoint
ALTER TABLE `items` ADD `year_from` integer GENERATED ALWAYS AS (case when "year" glob '[0-9][0-9][0-9][0-9]*' then cast(substr("year", 1, 4) as integer) end) VIRTUAL;--> statement-breakpoint
ALTER TABLE `items` ADD `form_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `items_form_key_unique` ON `items` (`form_key`);--> statement-breakpoint
ALTER TABLE `members` ADD `form_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `members_form_key_unique` ON `members` (`form_key`);