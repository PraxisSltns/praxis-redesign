-- A wardrobe piece's id is a hash of its type, name and source (src/core/request.ts wardrobeRef), not
-- random: two people who add the same sample piece get the same id. So the key is the account and the
-- id together, not the id alone (1762200000200 assumed random ids). Rows get a plain surrogate key.

-- Up Migration
ALTER TABLE wardrobe_items DROP CONSTRAINT wardrobe_items_pkey;
ALTER TABLE wardrobe_items ADD COLUMN wardrobe_row_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;
CREATE UNIQUE INDEX wardrobe_items_owner_item ON wardrobe_items (owner_user_id, wardrobe_item_id);

-- Down Migration
DROP INDEX wardrobe_items_owner_item;
ALTER TABLE wardrobe_items DROP COLUMN wardrobe_row_id;
ALTER TABLE wardrobe_items ADD PRIMARY KEY (wardrobe_item_id);
