CREATE TABLE IF NOT EXISTS vinted_detail_cache (
  offer_url TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  isbn TEXT,
  expires_at INTEGER NOT NULL,
  fetched_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_vinted_detail_cache_expiry ON vinted_detail_cache(expires_at);
