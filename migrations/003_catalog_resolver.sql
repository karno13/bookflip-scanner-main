ALTER TABLE identification_jobs
  ADD COLUMN result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json));

CREATE TABLE external_record_links (
  id INTEGER PRIMARY KEY,
  external_record_id TEXT NOT NULL REFERENCES external_records(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  work_id TEXT REFERENCES works(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  edition_id TEXT REFERENCES editions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  linked_at TEXT NOT NULL,
  UNIQUE (external_record_id, work_id),
  UNIQUE (external_record_id, edition_id),
  CHECK (work_id IS NOT NULL OR edition_id IS NOT NULL)
) STRICT;

CREATE INDEX idx_external_record_links_work
  ON external_record_links(work_id) WHERE work_id IS NOT NULL;

CREATE INDEX idx_external_record_links_edition
  ON external_record_links(edition_id) WHERE edition_id IS NOT NULL;
