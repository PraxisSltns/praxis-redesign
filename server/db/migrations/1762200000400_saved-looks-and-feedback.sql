-- Saved looks and More like this / Not for me (docs/data-schemas.md 9.2: saved_looks, feedback). A saved
-- look keeps its look as it was when saved (look_snapshot). request_id and recommendation_id point at
-- the styling history, which stays in the browser for now, so they carry no foreign key yet.

-- Up Migration
CREATE TABLE saved_looks (
  saved_look_id               text PRIMARY KEY,
  owner_user_id               text REFERENCES users (user_id) ON DELETE CASCADE,
  owner_anonymous_session_id  text NOT NULL,
  recommendation_id           text,
  request_id                  text,
  outfit_id                   text NOT NULL,
  input_key                   text,
  occasion_label              text NOT NULL,
  look_snapshot               jsonb NOT NULL,
  dedupe_key                  text NOT NULL,
  saved_at                    timestamptz NOT NULL DEFAULT now()
);
-- One look per account and dedupe key: the guest-to-account hand-over can't make duplicates.
CREATE UNIQUE INDEX saved_looks_user_dedupe ON saved_looks (owner_user_id, dedupe_key) WHERE owner_user_id IS NOT NULL;
CREATE INDEX saved_looks_anonymous ON saved_looks (owner_anonymous_session_id) WHERE owner_user_id IS NULL;

CREATE TABLE feedback (
  feedback_id           text PRIMARY KEY,
  anonymous_session_id  text NOT NULL,
  user_id               text REFERENCES users (user_id) ON DELETE CASCADE,
  recommendation_id     text NOT NULL,
  request_id            text NOT NULL,
  outfit_id             text NOT NULL,
  garment_id            text,
  feedback              text NOT NULL CHECK (feedback IN ('more_like_this', 'not_for_me')),
  reason                text CHECK (reason IN ('too_formal', 'too_casual', 'wrong_colours', 'wrong_fit', 'too_expensive')),
  adapter_id            text NOT NULL,
  adapter_version       text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_user ON feedback (user_id, created_at DESC);
CREATE INDEX feedback_anonymous ON feedback (anonymous_session_id, created_at DESC);

-- Down Migration
DROP TABLE feedback;
DROP TABLE saved_looks;
