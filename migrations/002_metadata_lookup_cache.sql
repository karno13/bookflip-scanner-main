CREATE TABLE metadata_lookup_cache (
  source TEXT NOT NULL CHECK (source IN ('bn', 'open_library')),
  lookup_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('found', 'not_found')),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  payload_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (source, lookup_key)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_metadata_lookup_cache_expires_at
  ON metadata_lookup_cache(expires_at);

CREATE TRIGGER external_records_immutable_update
BEFORE UPDATE ON external_records
BEGIN
  SELECT RAISE(ABORT, 'external_records are immutable');
END;

CREATE TRIGGER external_records_immutable_delete
BEFORE DELETE ON external_records
BEGIN
  SELECT RAISE(ABORT, 'external_records are immutable');
END;
