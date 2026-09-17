CREATE TABLE `item_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `item_tags` (
	`item_id` integer NOT NULL,
	`tag` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`item_id`, `tag`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`member_id` integer,
	`platform_key` text,
	`category` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`year` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`metric_value` text,
	`metric_unit` text,
	`metric_note` text,
	`published` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`platform_key`) REFERENCES `platforms`(`key`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_items_public` ON `items` (`type`,`published`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_items_member` ON `items` (`member_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`headline` text DEFAULT '' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`skills_text` text DEFAULT '' NOT NULL,
	`career_text` text DEFAULT '' NOT NULL,
	`avatar_url` text,
	`github` text,
	`email` text,
	`published` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_slug_unique` ON `members` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_members_public` ON `members` (`published`,`sort_order`);--> statement-breakpoint
CREATE TABLE `platforms` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_exp` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`member_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);