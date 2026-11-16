-- What is kept after an account is deleted (server/auth/controls.mjs). Nothing, by default: deleting an
-- account removes the user and, through ON DELETE CASCADE, its consents, sessions, saved looks, feedback,
-- wardrobe pieces and guest hand-overs, and the sign-in links sent to its address.
--
-- When ACCOUNT_DELETION_KEEP_CONSENT_DAYS is above 0 (a decision for the legal text), one row per
-- deletion keeps the consent history as proof of what was agreed, for that many days: the address only as
-- a SHA-256 hash, never in clear. Rows past keep_until are removed on every later deletion.

-- Up Migration
CREATE TABLE account_deletions (
  deletion_id   text PRIMARY KEY,
  email_sha256  text NOT NULL,
  deleted_at    timestamptz NOT NULL DEFAULT now(),
  keep_until    timestamptz NOT NULL,
  consents      jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX account_deletions_keep_until ON account_deletions (keep_until);

-- Down Migration
DROP TABLE account_deletions;
