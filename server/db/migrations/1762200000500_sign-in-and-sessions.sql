-- Sign-in by email link and sessions (server/auth). Only hashes of the link and session tokens are
-- stored: a leaked table can't sign anyone in. account_claims records each guest-to-account hand-over,
-- so a guest's saved looks move to an account once (docs/data-schemas.md 7.3, 9.4).

-- Up Migration
CREATE TABLE sign_in_links (
  token_hash            text PRIMARY KEY,
  email                 text NOT NULL,
  anonymous_session_id  text NOT NULL,
  -- The consents the person agreed to on the sign-in form: [{ "category": "terms", "version": "..." }, ...].
  consents              jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  used_at               timestamptz
);
CREATE INDEX sign_in_links_email ON sign_in_links (lower(email), created_at DESC);

CREATE TABLE sessions (
  session_hash  text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE account_claims (
  user_id               text NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  anonymous_session_id  text NOT NULL,
  claimed_at            timestamptz NOT NULL DEFAULT now(),
  looks_moved           integer NOT NULL DEFAULT 0,
  looks_duplicate       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, anonymous_session_id)
);

-- Down Migration
DROP TABLE account_claims;
DROP TABLE sessions;
DROP TABLE sign_in_links;
