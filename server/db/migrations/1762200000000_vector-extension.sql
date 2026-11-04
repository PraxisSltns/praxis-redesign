-- pgvector, for product embeddings (products.embedding). Same major version locally and on Railway: 0.8.x on Postgres 16.

-- Up Migration
CREATE EXTENSION IF NOT EXISTS vector;

-- Down Migration
DROP EXTENSION IF EXISTS vector;
