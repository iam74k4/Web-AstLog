CREATE TABLE `owner_claims` (
	`provider` text NOT NULL,
	`value` text NOT NULL,
	`subject` text NOT NULL,
	`ticket` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`provider`, `value`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_one_owner` ON `users` (`role`) WHERE "users"."role" = 'owner';