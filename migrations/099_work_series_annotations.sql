CREATE TABLE IF NOT EXISTS work_series_annotations (
  work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  series TEXT NOT NULL CHECK (length(trim(series)) BETWEEN 1 AND 120),
  volume INTEGER NOT NULL CHECK (volume BETWEEN 1 AND 10000),
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_work_series_annotations_series ON work_series_annotations(series,volume);
