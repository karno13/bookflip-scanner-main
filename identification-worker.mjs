import { randomUUID } from 'node:crypto';

const DECISION_TO_JOB_STATUS = Object.freeze({
  matched_existing: 'completed',
  created_edition: 'completed',
  created_work_and_edition: 'completed',
  review_required: 'review_required',
  not_found: 'completed',
  retry_pending: 'retry_wait',
});

function iso(value) { return value instanceof Date ? value.toISOString() : String(value); }

export function claimIdentificationJob(repository, {
  now = new Date(),
  leaseMs = 60_000,
  leaseToken = randomUUID(),
} = {}) {
  const at = iso(now);
  const leaseExpiresAt = new Date(new Date(at).getTime() + leaseMs).toISOString();
  return repository.transaction(() => repository.database.prepare(`UPDATE identification_jobs
    SET status='running',attempt_count=attempt_count+1,lease_token=?,lease_expires_at=?,updated_at=?
    WHERE id=(
      SELECT id FROM identification_jobs
      WHERE ((status IN ('queued','retry_wait') AND (run_after IS NULL OR run_after<=?))
        OR (status='running' AND lease_expires_at<=?))
      ORDER BY created_at,id LIMIT 1
    ) RETURNING *`).get(leaseToken, leaseExpiresAt, at, at, at) ?? null);
}

function storedResult(job) {
  try { return job?.result_json ? JSON.parse(job.result_json) : null; } catch { return null; }
}

export class IdentificationWorker {
  constructor({ repository, resolver, now = () => new Date(), leaseMs = 60_000, retryDelayMs = 5 * 60_000 } = {}) {
    if (!repository || !resolver) throw new TypeError('repository and resolver are required');
    this.repository = repository;
    this.resolver = resolver;
    this.now = now;
    this.leaseMs = leaseMs;
    this.retryDelayMs = retryDelayMs;
  }

  claim() {
    return claimIdentificationJob(this.repository, { now: this.now(), leaseMs: this.leaseMs });
  }

  async processJob(job) {
    if (!job) return null;
    if (job.status !== 'running') {
      const prior = storedResult(job);
      if (prior) return { job, result: prior, reused: true };
      throw new Error('JOB_NOT_RUNNING');
    }
    try {
      const result = await this.resolver.resolve({ offerId: job.offer_id });
      const status = DECISION_TO_JOB_STATUS[result.decision] ?? 'failed';
      const now = this.now();
      const runAfter = status === 'retry_wait' ? new Date(now.getTime() + this.retryDelayMs).toISOString() : null;
      const saved = this.repository.database.prepare(`UPDATE identification_jobs
        SET status=?,run_after=?,lease_token=NULL,lease_expires_at=NULL,last_error=?,result_json=?,updated_at=?
        WHERE id=? AND status='running' AND lease_token=?`).run(
        status,
        runAfter,
        status === 'retry_wait' ? 'METADATA_TEMPORARY_ERROR' : null,
        JSON.stringify(result),
        now.toISOString(),
        job.id,
        job.lease_token,
      );
      if (Number(saved.changes) !== 1) throw new Error('JOB_LEASE_LOST');
      return { job: this.repository.database.prepare('SELECT * FROM identification_jobs WHERE id=?').get(job.id), result, reused: false };
    } catch (error) {
      if (error.message === 'JOB_LEASE_LOST') throw error;
      const retryable=error.retryable===true || [408,425,429].includes(Number(error.status)) || (Number(error.status)>=500 && Number(error.status)<=599) || ['AbortError','TimeoutError'].includes(error.name) || /^(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)$/.test(String(error.code||error.cause?.code||''));
      const now=this.now();
      this.repository.database.prepare(`UPDATE identification_jobs
        SET status=?,run_after=?,lease_token=NULL,lease_expires_at=NULL,last_error=?,updated_at=?
        WHERE id=? AND status='running' AND lease_token=?`).run(retryable?'retry_wait':'failed',retryable?new Date(now.getTime()+this.retryDelayMs).toISOString():null,String(error.message ?? error),now.toISOString(), job.id, job.lease_token);
      throw error;
    }
  }

  async processNext() {
    const job = this.claim();
    return job ? this.processJob(job) : null;
  }

  async processBatch(limit = 10) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error('INVALID_BATCH_LIMIT');
    const items = [], errors = [];
    while (items.length + errors.length < limit) {
      try {
        const item = await this.processNext();
        if (!item) break;
        items.push(item);
      } catch (error) {
        errors.push(String(error.message ?? error));
      }
    }
    return { processed: items.length, failed: errors.length, errors, items };
  }

  async processJobId(jobId) {
    const existing = this.repository.database.prepare('SELECT * FROM identification_jobs WHERE id=?').get(jobId);
    if (!existing) throw new Error('JOB_NOT_FOUND');
    if (['completed', 'review_required'].includes(existing.status) && existing.result_json) return { job: existing, result: storedResult(existing), reused: true };
    if (existing.status !== 'running') {
      this.repository.database.prepare("UPDATE identification_jobs SET status='queued',run_after=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?").run(this.now().toISOString(), jobId);
    }
    const claimed = this.repository.transaction(() => {
      const token = randomUUID(), at = this.now(), expires = new Date(at.getTime() + this.leaseMs).toISOString();
      return this.repository.database.prepare("UPDATE identification_jobs SET status='running',attempt_count=attempt_count+1,lease_token=?,lease_expires_at=?,updated_at=? WHERE id=? AND status='queued' RETURNING *").get(token, expires, at.toISOString(), jobId);
    });
    return this.processJob(claimed);
  }
}

export { DECISION_TO_JOB_STATUS };
