CREATE TABLE `line_transfers` (
  `material_key` text PRIMARY KEY NOT NULL,
  `material_code` text NOT NULL,
  `quantity` real DEFAULT 0 NOT NULL,
  `updated_at` text NOT NULL
);
