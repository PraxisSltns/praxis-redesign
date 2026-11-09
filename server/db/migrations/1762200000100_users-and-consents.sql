-- Accounts and consent history (docs/data-schemas.md 9.2: users, consents). Ids are text in the app's
-- own prefix_ format (src/core/ids.ts newId). Consent keeps every grant and withdrawal: the current
-- consent is the newest row for an owner and category whose version matches the policy and whose
-- withdrawn_at is empty (the rule consentFor uses in the browser).

-- Up Migration
CREATE TABLE users (
  user_id       text PRIMARY KEY,
  email         text NOT NULL,
  display_name  text,
  premium       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE consents (
  consent_id                  text PRIMARY KEY,
  owner_user_id               text REFERENCES users (user_id) ON DELETE CASCADE,
  owner_anonymous_session_id  text NOT NULL,
  -- An image policy (face_colour, body_fit, wardrobe_garment, try_on) or an account consent added at sign-up.
  category                    text NOT NULL,
  version                     text NOT NULL,
  granted_at                  timestamptz NOT NULL DEFAULT now(),
  withdrawn_at                timestamptz,
  CHECK (withdrawn_at IS NULL OR withdrawn_at >= granted_at)
);
CREATE INDEX consents_user_category ON consents (owner_user_id, category, granted_at DESC);
CREATE INDEX consents_anonymous_category ON consents (owner_anonymous_session_id, category, granted_at DESC);

-- Down Migration
DROP TABLE consents;
DROP TABLE users;
