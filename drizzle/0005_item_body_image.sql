ALTER TABLE `items` ADD `body` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `image_url` text;--> statement-breakpoint
ALTER TABLE `items` ADD `image_alt` text DEFAULT '' NOT NULL;