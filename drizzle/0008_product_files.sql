CREATE TABLE `product_files` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `category` text NOT NULL,
  `file_name` text NOT NULL,
  `object_key` text NOT NULL,
  `size` integer NOT NULL,
  `sha256` text NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `uploaded_by` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `product_files_product_idx` ON `product_files` (`product_id`,`category`,`active`,`created_at`);
