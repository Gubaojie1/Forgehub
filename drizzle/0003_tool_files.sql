CREATE TABLE `tool_files` (`id` text PRIMARY KEY NOT NULL, `tool_id` text NOT NULL, `product_id` text, `file_name` text NOT NULL, `object_key` text NOT NULL, `size` integer NOT NULL, `sha256` text NOT NULL, `uploaded_by` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `tool_files_tool_idx` ON `tool_files` (`tool_id`,`created_at`);
