CREATE TABLE `products` (`id` text PRIMARY KEY NOT NULL, `code` text NOT NULL, `name` text NOT NULL, `family` text NOT NULL, `hw_versions` text NOT NULL, `owner` text NOT NULL, `status` text NOT NULL, `description` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_code_unique` ON `products` (`code`);
--> statement-breakpoint
CREATE TABLE `releases` (`id` text PRIMARY KEY NOT NULL, `product_id` text NOT NULL, `version` text NOT NULL, `build_number` text NOT NULL, `channel` text NOT NULL, `status` text NOT NULL, `bootloader_version` text NOT NULL, `app_version` text NOT NULL, `protocol_summary` text NOT NULL, `release_date` text NOT NULL, `artifact_count` integer DEFAULT 0 NOT NULL);
--> statement-breakpoint
CREATE TABLE `protocols` (`id` text PRIMARY KEY NOT NULL, `product_id` text NOT NULL, `name` text NOT NULL, `version` text NOT NULL, `interface_type` text NOT NULL, `updated_at` text NOT NULL, `status` text NOT NULL, `description` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `tools` (`id` text PRIMARY KEY NOT NULL, `product_id` text, `name` text NOT NULL, `version` text NOT NULL, `platform` text NOT NULL, `updated_at` text NOT NULL, `status` text NOT NULL, `description` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `artifacts` (`id` text PRIMARY KEY NOT NULL, `release_id` text NOT NULL, `product_id` text NOT NULL, `kind` text NOT NULL, `name` text NOT NULL, `revision` text NOT NULL, `object_key` text NOT NULL, `size` integer NOT NULL, `sha256` text NOT NULL, `status` text NOT NULL, `active` integer DEFAULT 0 NOT NULL, `uploaded_by` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `replacement_requests` (`id` text PRIMARY KEY NOT NULL, `product_id` text NOT NULL, `release_id` text NOT NULL, `source_artifact_id` text NOT NULL, `candidate_artifact_id` text NOT NULL, `artifact_name` text NOT NULL, `current_revision` text NOT NULL, `new_revision` text NOT NULL, `reason` text NOT NULL, `impact` text NOT NULL, `requester` text NOT NULL, `status` text NOT NULL, `created_at` text NOT NULL, `reviewed_by` text, `reviewed_at` text);
