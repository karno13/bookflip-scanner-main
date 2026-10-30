CREATE TABLE works (
  id TEXT PRIMARY KEY,
  legacy_id TEXT UNIQUE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  normalized_title TEXT,
  authors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(authors_json)),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','historical_unverified','manual','verified')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE editions (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  legacy_id TEXT UNIQUE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  publisher TEXT,
  publication_year INTEGER CHECK (publication_year IS NULL OR publication_year BETWEEN 1400 AND 2100),
  language TEXT,
  binding TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','historical_unverified','manual','verified')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE edition_identifiers (
  id INTEGER PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  scheme TEXT NOT NULL CHECK (scheme IN ('isbn10','isbn13','open_library','bn','other')),
  normalized_value TEXT NOT NULL CHECK (length(normalized_value) BETWEEN 1 AND 300),
  source TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','historical_unverified','manual','verified')),
  created_at TEXT NOT NULL,
  UNIQUE (scheme, normalized_value),
  UNIQUE (edition_id, scheme, normalized_value)
) STRICT;

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  legacy_id TEXT UNIQUE,
  source TEXT NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 100),
  external_offer_id TEXT,
  normalized_url TEXT NOT NULL,
  original_title TEXT NOT NULL DEFAULT '' CHECK (length(original_title) <= 500),
  current_price INTEGER CHECK (current_price IS NULL OR current_price > 0),
  currency TEXT NOT NULL DEFAULT 'PLN' CHECK (length(currency) = 3),
  availability TEXT NOT NULL DEFAULT 'unconfirmed',
  language TEXT,
  observed_isbn TEXT,
  matched_queries_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(matched_queries_json)),
  first_seen_at TEXT,
  last_seen_at TEXT,
  seen_count INTEGER NOT NULL DEFAULT 0 CHECK (seen_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE offer_price_history (
  id INTEGER PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  price INTEGER NOT NULL CHECK (price > 0),
  observed_at TEXT NOT NULL,
  UNIQUE (offer_id, price, observed_at)
) STRICT;

CREATE TABLE offer_matches (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('manual','legacy_manual','legacy_isbn','structured_isbn','metadata','external_record')),
  status TEXT NOT NULL CHECK (status IN ('active','review_required','superseded','rejected')),
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  reason TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE external_records (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('bn','open_library','legacy','other')),
  external_id TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('work','edition','unknown')),
  work_id TEXT REFERENCES works(id) ON UPDATE CASCADE ON DELETE SET NULL,
  edition_id TEXT REFERENCES editions(id) ON UPDATE CASCADE ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'found' CHECK (status IN ('found','not_found','temporary_error','conflict')),
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  payload_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (provider, external_id, payload_hash)
) STRICT;

CREATE TABLE metadata_evidence (
  id TEXT PRIMARY KEY,
  work_id TEXT REFERENCES works(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  edition_id TEXT REFERENCES editions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  offer_id TEXT REFERENCES offers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  external_record_id TEXT REFERENCES external_records(id) ON UPDATE CASCADE ON DELETE SET NULL,
  field_name TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  classification TEXT NOT NULL CHECK (classification IN ('structured','labelled_description','unlabelled_description','ocr','uncertain','legacy')),
  source_type TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','historical_unverified','manual','verified','conflict')),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (work_id IS NOT NULL OR edition_id IS NOT NULL OR offer_id IS NOT NULL)
) STRICT;

CREATE TABLE identification_jobs (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  job_type TEXT NOT NULL DEFAULT 'identify_edition',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','retry_wait','review_required','completed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  run_after TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (offer_id, job_type)
) STRICT;

CREATE INDEX idx_editions_work ON editions(work_id);
CREATE INDEX idx_edition_identifiers_edition ON edition_identifiers(edition_id);
CREATE UNIQUE INDEX uq_offers_source_external
  ON offers(source, external_offer_id) WHERE external_offer_id IS NOT NULL;
CREATE UNIQUE INDEX uq_offers_source_url
  ON offers(source, normalized_url) WHERE external_offer_id IS NULL;
CREATE INDEX idx_offer_price_history_offer_time ON offer_price_history(offer_id, observed_at);
CREATE INDEX idx_offer_matches_offer_time ON offer_matches(offer_id, valid_from DESC);
CREATE INDEX idx_offer_matches_edition_status ON offer_matches(edition_id, status);
CREATE UNIQUE INDEX uq_offer_matches_active ON offer_matches(offer_id) WHERE status = 'active';
CREATE INDEX idx_external_records_lookup ON external_records(provider, external_id, fetched_at DESC);
CREATE INDEX idx_external_records_work ON external_records(work_id) WHERE work_id IS NOT NULL;
CREATE INDEX idx_external_records_edition ON external_records(edition_id) WHERE edition_id IS NOT NULL;
CREATE INDEX idx_metadata_evidence_work ON metadata_evidence(work_id) WHERE work_id IS NOT NULL;
CREATE INDEX idx_metadata_evidence_edition ON metadata_evidence(edition_id) WHERE edition_id IS NOT NULL;
CREATE INDEX idx_metadata_evidence_offer ON metadata_evidence(offer_id) WHERE offer_id IS NOT NULL;
CREATE INDEX idx_identification_jobs_claim
  ON identification_jobs(status, run_after, lease_expires_at, created_at);

CREATE TRIGGER metadata_evidence_immutable_update
BEFORE UPDATE ON metadata_evidence BEGIN
  SELECT RAISE(ABORT, 'METADATA_EVIDENCE_IMMUTABLE');
END;

CREATE TRIGGER metadata_evidence_immutable_delete
BEFORE DELETE ON metadata_evidence BEGIN
  SELECT RAISE(ABORT, 'METADATA_EVIDENCE_IMMUTABLE');
END;
