ALTER TABLE `users` ADD COLUMN `status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `last_login_at` text;
--> statement-breakpoint
CREATE TABLE `hardware_variants` (`id` text PRIMARY KEY NOT NULL, `product_id` text NOT NULL, `code` text NOT NULL, `mcu` text NOT NULL, `flash_size` text NOT NULL, `ram_size` text NOT NULL, `pcb_version` text NOT NULL, `min_bootloader` text NOT NULL, `interfaces` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `hardware_variants_product_code_unique` ON `hardware_variants` (`product_id`,`code`);
--> statement-breakpoint
CREATE TABLE `product_asset_types` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `product_id` text NOT NULL, `asset_type` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_asset_types_product_type_unique` ON `product_asset_types` (`product_id`,`asset_type`);
--> statement-breakpoint
CREATE TABLE `audit_logs` (`id` text PRIMARY KEY NOT NULL, `actor_email` text NOT NULL, `action` text NOT NULL, `resource_type` text NOT NULL, `resource_id` text NOT NULL, `detail` text NOT NULL, `created_at` text NOT NULL);
