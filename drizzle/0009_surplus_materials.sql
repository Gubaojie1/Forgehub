CREATE TABLE IF NOT EXISTS `surplus_materials` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `category` text NOT NULL DEFAULT '其他',
  `quantity` integer NOT NULL,
  `available_quantity` integer NOT NULL,
  `note` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT '可领用',
  `publisher_email` text NOT NULL,
  `publisher_name` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `material_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `material_id` text NOT NULL,
  `requester_email` text NOT NULL,
  `requester_name` text NOT NULL,
  `quantity` integer NOT NULL,
  `note` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT '待确认',
  `created_at` text NOT NULL,
  `resolved_at` text,
  `resolved_by` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `surplus_materials_status_idx` ON `surplus_materials` (`status`, `updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `material_requests_material_idx` ON `material_requests` (`material_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `material_requests_requester_idx` ON `material_requests` (`requester_email`, `created_at`);
