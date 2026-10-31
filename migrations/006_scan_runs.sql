CREATE TABLE scan_runs (
 scanned_at TEXT PRIMARY KEY,
 summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_scan_runs_latest ON scan_runs(scanned_at DESC);
