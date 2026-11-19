-- Trigram + full-text search for product translations.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Per-row generated tsvector over the translated name + description.
ALTER TABLE "product_translations"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("description", ''))
  ) STORED;

-- Full-text GIN index (per-locale filtering happens via the locale column in queries).
CREATE INDEX "product_translations_search_vector_idx"
  ON "product_translations" USING GIN ("search_vector");

-- Trigram GIN index for fuzzy name matching / autocomplete.
CREATE INDEX "product_translations_name_trgm_idx"
  ON "product_translations" USING GIN ("name" gin_trgm_ops);

-- Trigram index on category translation names too.
CREATE INDEX "category_translations_name_trgm_idx"
  ON "category_translations" USING GIN ("name" gin_trgm_ops);
