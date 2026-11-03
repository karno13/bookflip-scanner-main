// Repository-side retry logic; HTTP routing must not own SQL statements.
const allowedModes = new Set(['failed', 'not_found', 'review_required']);

export function retryIdentificationJobs(repository, mode, now = () => new Date()) {
  if (!allowedModes.has(mode)) {
    throw Object.assign(Error('INVALID_RETRY_MODE'), { statusCode: 400 });
  }
  const manualMatchGuard = `NOT EXISTS (
    SELECT 1 FROM offer_matches m WHERE m.offer_id = identification_jobs.offer_id
    AND m.status = 'active' AND m.method IN ('manual','legacy_manual')
  )`;
  const bundleGuard = `NOT EXISTS (
    SELECT 1 FROM offer_sets s WHERE s.offer_id = identification_jobs.offer_id
  )`;
  const condition = mode === 'not_found'
    ? "status='completed' AND json_valid(result_json) AND json_extract(result_json,'$.decision')='not_found'"
    : 'status = ?';
  const statement = repository.database.prepare(`
    UPDATE identification_jobs
    SET status='queued',run_after=NULL,lease_token=NULL,lease_expires_at=NULL,
        last_error=NULL,updated_at=?
    WHERE ${condition} AND ${manualMatchGuard} AND ${bundleGuard}
  `);
  const timestamp = now().toISOString();
  const args = mode === 'not_found' ? [timestamp] : [timestamp, mode];
  const changed = repository.transaction(() => statement.run(...args).changes);
  return { queued: Number(changed) };
}
