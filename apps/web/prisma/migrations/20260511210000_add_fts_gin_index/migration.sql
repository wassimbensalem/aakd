-- Add stored generated tsvector column for FTS (title + counterpartyName + notes only;
-- extractedText excluded from index because it can exceed PostgreSQL's tsvector size limits.
-- The search route falls back to searching extractedText via the existing $queryRaw path.)
ALTER TABLE "Contract"
  ADD COLUMN IF NOT EXISTS search_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce("counterpartyName", '') || ' ' ||
      coalesce(notes, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_contract_search_tsv
  ON "Contract" USING GIN(search_tsv);
