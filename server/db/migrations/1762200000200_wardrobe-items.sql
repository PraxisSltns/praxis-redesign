-- Pieces the customer owns (docs/data-schemas.md 9.2: wardrobe_items; src/core/data.ts WardrobeEntry).
-- Ids are random (wardrobe_...), so the id alone is the key. Photos are not stored: they stay in the tab.

-- Up Migration
CREATE TABLE wardrobe_items (
  wardrobe_item_id            text PRIMARY KEY,
  owner_user_id               text REFERENCES users (user_id) ON DELETE CASCADE,
  owner_anonymous_session_id  text NOT NULL,
  slot                        text NOT NULL CHECK (slot IN ('top', 'bottom', 'shoes', 'extras')),
  label                       text NOT NULL,
  source                      text NOT NULL CHECK (source IN ('sample', 'upload', 'described')),
  colour                      text,
  added_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz
);
CREATE INDEX wardrobe_items_user ON wardrobe_items (owner_user_id);
CREATE INDEX wardrobe_items_anonymous ON wardrobe_items (owner_anonymous_session_id);

-- Down Migration
DROP TABLE wardrobe_items;
