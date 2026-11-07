-- Facts read from an offer's own detail page (ISBN, publisher, author, year, ...).
-- One row per offer records whether the page was read, so that it is not fetched again and
-- transient failures are retried a bounded number of times.
CREATE TABLE offer_enrichment (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('isbn_found','no_isbn','error')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts >= 1),
  attempted_at TEXT NOT NULL,
  isbn TEXT,
  facts_json TEXT CHECK(facts_json IS NULL OR json_valid(facts_json)),
  last_error TEXT
) STRICT;
CREATE INDEX idx_offer_enrichment_outcome ON offer_enrichment(outcome, attempted_at);
