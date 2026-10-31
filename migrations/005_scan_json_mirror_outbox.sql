-- Durable JSON mirror checkpoint committed in the same SQLite transaction as a scan.
CREATE TABLE scan_json_mirror_outbox (
 id TEXT PRIMARY KEY,
 snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
 scanned_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','conflict')),
 created_at TEXT NOT NULL,
 completed_at TEXT
) STRICT;
CREATE INDEX idx_scan_json_mirror_outbox_pending ON scan_json_mirror_outbox(status,created_at) WHERE status='pending';
