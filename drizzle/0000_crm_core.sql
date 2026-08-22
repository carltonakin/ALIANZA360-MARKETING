CREATE TABLE `leads` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 `name` text NOT NULL, `email` text NOT NULL, `phone` text DEFAULT '' NOT NULL,
 `social` text DEFAULT '' NOT NULL, `source` text DEFAULT 'Landing Page' NOT NULL,
 `status` text DEFAULT 'New' NOT NULL, `value` real DEFAULT 0 NOT NULL, `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `name` text NOT NULL,
 `platform` text NOT NULL, `audience` text NOT NULL, `message` text NOT NULL,
 `budget` real DEFAULT 0 NOT NULL, `status` text DEFAULT 'Draft' NOT NULL,
 `impressions` integer DEFAULT 0 NOT NULL, `clicks` integer DEFAULT 0 NOT NULL, `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `landing_pages` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `title` text NOT NULL,
 `slug` text NOT NULL, `headline` text NOT NULL, `teaser` text DEFAULT '' NOT NULL,
 `webinar_url` text DEFAULT '' NOT NULL, `payment_url` text DEFAULT '' NOT NULL,
 `status` text DEFAULT 'Draft' NOT NULL, `registrations` integer DEFAULT 0 NOT NULL, `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `landing_pages_slug_unique` ON `landing_pages` (`slug`);
--> statement-breakpoint
CREATE TABLE `activities` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `type` text NOT NULL,
 `title` text NOT NULL, `detail` text NOT NULL, `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_leads_status` ON `leads` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_campaigns_status` ON `campaigns` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_activities_created_at` ON `activities` (`created_at`);
--> statement-breakpoint
PRAGMA optimize;
