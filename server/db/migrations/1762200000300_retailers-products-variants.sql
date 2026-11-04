-- The product catalogue fed by retailer imports (server/retailers, Week 1 phase 3). A product is one
-- retailer's piece; size, price and stock live on its variants. slot and layer follow the shared
-- ontology (src/shared/ontology.mjs); a piece that doesn't map has no slot and is never styled.
-- A piece that leaves the feed is kept and marked removed_at, its variants unavailable, never deleted.
-- embedding is a normalised 768-dimension vector (Marqo-FashionSigLIP), searched by cosine distance.

-- Up Migration
CREATE TABLE retailers (
  retailer_id       text PRIMARY KEY,
  name              text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('shopify', 'csv')),
  source            text NOT NULL,
  currency          char(3) NOT NULL DEFAULT 'USD',
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_imported_at  timestamptz
);

CREATE TABLE products (
  product_id     text PRIMARY KEY,
  retailer_id    text NOT NULL REFERENCES retailers (retailer_id) ON DELETE CASCADE,
  external_id    text NOT NULL,
  title          text NOT NULL,
  brand          text,
  description    text,
  product_url    text,
  images         jsonb NOT NULL DEFAULT '[]'::jsonb,
  slot           text CHECK (slot IN ('top', 'bottom', 'shoes', 'extras')),
  layer          text CHECK (layer IN ('outer', 'base')),
  subcategory    text,
  colour         text,
  price_amount   numeric(12, 2) CHECK (price_amount >= 0),
  currency       char(3),
  cutout_url     text,
  embedding      vector(768),
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  removed_at     timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (retailer_id, external_id)
);
CREATE INDEX products_slot ON products (slot) WHERE removed_at IS NULL;
CREATE INDEX products_embedding_hnsw ON products USING hnsw (embedding vector_cosine_ops);

CREATE TABLE product_variants (
  variant_id      text PRIMARY KEY,
  product_id      text NOT NULL REFERENCES products (product_id) ON DELETE CASCADE,
  external_id     text NOT NULL,
  size            text,
  colour          text,
  sku             text,
  price_amount    numeric(12, 2) CHECK (price_amount >= 0),
  currency        char(3),
  available       boolean NOT NULL DEFAULT false,
  -- Null when the retailer only says in or out of stock (Shopify's public list).
  stock_quantity  integer CHECK (stock_quantity >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, external_id)
);
CREATE INDEX product_variants_in_stock ON product_variants (product_id, size) WHERE available;

-- Down Migration
DROP TABLE product_variants;
DROP TABLE products;
DROP TABLE retailers;
