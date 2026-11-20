ALTER TABLE `releases` ADD COLUMN `min_upgrade_version` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `releases` ADD COLUMN `allow_downgrade` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `releases` ADD COLUMN `release_notes` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `releases` ADD COLUMN `known_issues` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `release_hardware_bindings` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `release_id` text NOT NULL, `hardware_variant_id` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_hardware_bindings_unique` ON `release_hardware_bindings` (`release_id`,`hardware_variant_id`);
--> statement-breakpoint
CREATE TABLE `release_protocol_bindings` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `release_id` text NOT NULL, `protocol_id` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_protocol_bindings_unique` ON `release_protocol_bindings` (`release_id`,`protocol_id`);
