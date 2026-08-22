CREATE TABLE `social_listener_config` (
  `id` integer PRIMARY KEY NOT NULL,
  `service_url` text NOT NULL,
  `token_ciphertext` text NOT NULL,
  `token_iv` text NOT NULL,
  `updated_by` text NOT NULL,
  `updated_at` integer NOT NULL
);
