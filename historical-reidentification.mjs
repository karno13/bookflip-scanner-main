export function planHistoricalReidentification(repository, { limit = 100 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) throw new Error('INVALID_HISTORY_LIMIT');
  const rows = repository.database.prepare(`SELECT m.id AS match_id,m.offer_id,m.edition_id,o.observed_isbn,o.original_title,j.id AS job_id,j.status AS job_status
    FROM offer_matches m JOIN offers o ON o.id=m.offer_id
    LEFT JOIN identification_jobs j ON j.offer_id=o.id AND j.job_type='identify_edition'
    WHERE m.method='legacy_isbn' AND m.status='review_required'
    ORDER BY m.created_at,m.id LIMIT ?`).all(limit);
  return {
    dryRun: true,
    count: rows.length,
    items: rows.map((row) => ({
      offerId: row.offer_id,
      historicalEditionId: row.edition_id,
      historicalMatchId: row.match_id,
      isbn: row.observed_isbn,
      title: row.original_title,
      jobId: row.job_id,
      jobStatus: row.job_status,
      plannedAction: 'queue_individual_resolution',
      automaticAcceptance: false,
    })),
  };
}

export function queueHistoricalReidentification(repository, { limit = 100, dryRun = true, now = () => new Date() } = {}) {
  const plan = planHistoricalReidentification(repository, { limit });
  if (dryRun) return plan;
  let queued = 0;
  repository.transaction(() => {
    for (const item of plan.items) {
      if (item.jobId) {
        const result = repository.database.prepare(`UPDATE identification_jobs SET status='queued',run_after=NULL,lease_token=NULL,
          lease_expires_at=NULL,last_error=NULL,result_json=NULL,updated_at=? WHERE id=? AND status!='running'`).run(now().toISOString(), item.jobId);
        queued += Number(result.changes);
      } else {
        const saved = repository.putIdentificationJob({ offerId: item.offerId, status: 'queued', at: now() });
        queued += saved.created ? 1 : 0;
      }
    }
  });
  return { ...plan, dryRun: false, queued };
}
