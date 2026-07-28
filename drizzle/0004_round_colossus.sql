CREATE TABLE IF NOT EXISTS `program_change_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`detected_at` text NOT NULL,
	`previous_fetched_at` text,
	`current_fetched_at` text NOT NULL,
	`added_count` integer DEFAULT 0 NOT NULL,
	`modified_count` integer DEFAULT 0 NOT NULL,
	`removed_count` integer DEFAULT 0 NOT NULL,
	`details_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `program_change_detected_idx` ON `program_change_events` (`detected_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `stock_depot_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_code` text NOT NULL,
	`depot` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `stock_depot_material_uq` ON `stock_depot_items` (`material_code`,`depot`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `stock_sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`source_name` text,
	`status` text NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`depot_record_count` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text NOT NULL,
	`message` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `stock_sync_completed_idx` ON `stock_sync_runs` (`completed_at`);
