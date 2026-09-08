CREATE TABLE `analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`context` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analyses_owner_time` ON `analyses` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `analysis_locks` (
	`owner` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telemetry` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`payload` text NOT NULL,
	`observed_at` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `telemetry_owner_time` ON `telemetry` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `workloads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workloads_owner_time` ON `workloads` (`owner`,`created_at`);