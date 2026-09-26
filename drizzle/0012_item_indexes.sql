DROP INDEX `idx_items_public`;--> statement-breakpoint
DROP INDEX `idx_items_member`;--> statement-breakpoint
CREATE INDEX `idx_items_kind` ON `items` (`type`,`published`,"year_from" desc,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_items_public` ON `items` (`published`,"year_from" desc,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_items_member` ON `items` (`member_id`,`published`,"year_from" desc,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_item_links_item` ON `item_links` (`item_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_item_tags_item` ON `item_tags` (`item_id`,`sort_order`);