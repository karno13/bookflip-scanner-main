-- Title-based ISBN proposals for offers that carry no ISBN. A proposal is only a suggestion shown
-- to the operator; nothing is ever assigned from a title without an explicit confirmation.
CREATE TABLE title_proposals (
  job_id TEXT PRIMARY KEY REFERENCES identification_jobs(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  computed_at TEXT NOT NULL,
  queries_json TEXT NOT NULL CHECK(json_valid(queries_json)),
  candidates_json TEXT NOT NULL CHECK(json_valid(candidates_json)),
  best_isbn TEXT,
  best_score REAL,
  confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low','none'))
) STRICT;
CREATE INDEX idx_title_proposals_confidence ON title_proposals(confidence, best_score DESC);
