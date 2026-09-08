CREATE TABLE `collector_tokens` (
	`owner` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collector_tokens_token_hash_unique` ON `collector_tokens` (`token_hash`);