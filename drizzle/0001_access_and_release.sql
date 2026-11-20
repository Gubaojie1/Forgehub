CREATE TABLE `users` (`email` text PRIMARY KEY NOT NULL, `display_name` text NOT NULL, `role` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `product_permissions` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `user_email` text NOT NULL, `product_id` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_permissions_user_product_unique` ON `product_permissions` (`user_email`,`product_id`);
--> statement-breakpoint
CREATE TABLE `protocol_files` (`id` text PRIMARY KEY NOT NULL, `protocol_id` text NOT NULL, `product_id` text NOT NULL, `file_name` text NOT NULL, `object_key` text NOT NULL, `size` integer NOT NULL, `sha256` text NOT NULL, `uploaded_by` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `release_requests` (`id` text PRIMARY KEY NOT NULL, `release_id` text NOT NULL, `product_id` text NOT NULL, `summary` text NOT NULL, `verification` text NOT NULL, `requester` text NOT NULL, `status` text NOT NULL, `created_at` text NOT NULL, `reviewed_by` text, `reviewed_at` text);
--> statement-breakpoint
CREATE TABLE `settings` (`key` text PRIMARY KEY NOT NULL, `value` text NOT NULL);
