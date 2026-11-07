-- BN lookup used to ask only for the exact ISBN form, so books indexed under ISBN-10 were
-- reported as "not found". The adapter now tries every equivalent form. Forget the stale
-- negative answers and re-evaluate the offers that were closed because of them.
-- Positive answers, manual assignments and bundles are untouched.
DELETE FROM metadata_lookup_cache WHERE status = 'not_found';

UPDATE identification_jobs
SET status = 'queued', run_after = NULL, lease_token = NULL, lease_expires_at = NULL,
    last_error = NULL, result_json = NULL, attempt_count = 0,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'completed'
  AND json_valid(result_json)
  AND json_extract(result_json, '$.decision') = 'not_found'
  AND NOT EXISTS (
    SELECT 1 FROM offer_matches m
    WHERE m.offer_id = identification_jobs.offer_id AND m.status = 'active'
      AND m.method IN ('manual', 'legacy_manual'))
  AND NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id = identification_jobs.offer_id);
