CREATE TABLE `edit_guard` (
	`id` integer PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "edit_version_matches" CHECK("edit_guard"."valid" = 1)
);
