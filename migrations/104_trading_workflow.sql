CREATE TABLE scan_offer_results (
  scanned_at TEXT NOT NULL REFERENCES scan_runs(scanned_at) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  is_new INTEGER NOT NULL CHECK(is_new IN (0,1)),
  price_changed INTEGER NOT NULL CHECK(price_changed IN (0,1)),
  PRIMARY KEY(scanned_at,offer_id)
) STRICT;
CREATE INDEX idx_scan_offer_results_offer ON scan_offer_results(offer_id,scanned_at DESC);
CREATE TABLE source_health (
  source TEXT PRIMARY KEY,
  last_checked_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  status TEXT NOT NULL
) STRICT;
CREATE TABLE app_preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE offer_scenarios (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
  purchase REAL CHECK(purchase IS NULL OR purchase BETWEEN 0 AND 100000000),
  shipping REAL CHECK(shipping IS NULL OR shipping BETWEEN 0 AND 100000000),
  other REAL CHECK(other IS NULL OR other BETWEEN 0 AND 100000000),
  resale REAL CHECK(resale IS NULL OR resale BETWEEN 0 AND 100000000),
  actual_purchase REAL CHECK(actual_purchase IS NULL OR actual_purchase BETWEEN 0 AND 100000000),
  updated_at TEXT NOT NULL
) STRICT;
ALTER TABLE offer_set_editions ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 10000);
ALTER TABLE offer_set_editions ADD COLUMN resale_price REAL CHECK(resale_price IS NULL OR resale_price BETWEEN 0 AND 100000000);
ALTER TABLE offer_sets ADD COLUMN composition_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(composition_confirmed IN (0,1));
CREATE TABLE offer_set_unknown_items (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offer_sets(offer_id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 10000)
) STRICT;
CREATE INDEX idx_set_unknown_offer ON offer_set_unknown_items(offer_id);
CREATE TABLE review_revisions (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE REFERENCES review_decisions(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE catalog_work_merges (
  source_id TEXT PRIMARY KEY REFERENCES works(id),
  target_id TEXT NOT NULL REFERENCES works(id),
  created_at TEXT NOT NULL,
  CHECK(source_id<>target_id)
) STRICT;
