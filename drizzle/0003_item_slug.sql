ALTER TABLE `items` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `items_slug_unique` ON `items` (`slug`);