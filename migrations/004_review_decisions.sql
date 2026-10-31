CREATE TABLE review_decisions (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES identification_jobs(id) ON UPDATE CASCADE ON DELETE SET NULL,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  edition_id TEXT REFERENCES editions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('approved','proposal_rejected','not_book','requeued')),
  reason TEXT,
  created_by TEXT NOT NULL DEFAULT 'local_user',
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_review_decisions_offer_time ON review_decisions(offer_id, created_at DESC);
CREATE INDEX idx_review_decisions_job_time ON review_decisions(job_id, created_at DESC) WHERE job_id IS NOT NULL;

CREATE TRIGGER review_decisions_immutable_update
BEFORE UPDATE ON review_decisions BEGIN
  SELECT RAISE(ABORT, 'REVIEW_DECISIONS_IMMUTABLE');
END;

CREATE TRIGGER review_decisions_immutable_delete
BEFORE DELETE ON review_decisions BEGIN
  SELECT RAISE(ABORT, 'REVIEW_DECISIONS_IMMUTABLE');
END;
