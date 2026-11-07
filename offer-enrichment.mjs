import { createHash } from 'node:crypto';
import { readSourceHtml } from './marketplaces.mjs';
import { DETAIL_SOURCES, parseProductDetail } from './source-details.mjs';

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 60 * 60 * 1000;

const stableId = (...parts) =>
  'enrich_' + createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);

/** Offers without an ISBN whose detail page has not been read yet (or failed long enough ago to retry). */
export function pendingEnrichment(
  repository,
  { sources = [...DETAIL_SOURCES], limit = 40, now = () => new Date() } = {},
) {
  if (!sources.length) return [];
  const marks = sources.map(() => '?').join(',');
  const retryBefore = new Date(now().getTime() - RETRY_AFTER_MS).toISOString();
  return repository.database
    .prepare(
      `SELECT o.id, o.source, o.normalized_url AS url
       FROM offers o LEFT JOIN offer_enrichment e ON e.offer_id = o.id
       WHERE o.source IN (${marks}) AND (o.observed_isbn IS NULL OR o.observed_isbn = '')
         AND (e.offer_id IS NULL OR (e.outcome = 'error' AND e.attempts < ? AND e.attempted_at <= ?))
       ORDER BY o.last_seen_at DESC LIMIT ?`,
    )
    .all(...sources, MAX_ATTEMPTS, retryBefore, Math.max(1, Math.min(500, limit)));
}

/** Sends a job back to the resolver when new evidence arrived. Manual decisions and bundles stay put. */
export function requeueForNewEvidence(repository, offerId, at) {
  const result = repository.database
    .prepare(
      `UPDATE identification_jobs
       SET status='queued', run_after=NULL, lease_token=NULL, lease_expires_at=NULL, last_error=NULL,
           result_json=NULL, attempt_count=0, updated_at=?
       WHERE offer_id=? AND (status='review_required'
              OR (status='completed' AND json_valid(result_json) AND json_extract(result_json,'$.decision')='not_found'))
         AND NOT EXISTS (SELECT 1 FROM offer_matches m WHERE m.offer_id=identification_jobs.offer_id
              AND m.status='active' AND m.method IN ('manual','legacy_manual'))
         AND NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id=identification_jobs.offer_id)`,
    )
    .run(at, offerId);
  return Number(result.changes) > 0;
}

function record(repository, offer, { outcome, isbn = null, facts = null, error = null }, at) {
  repository.database
    .prepare(
      `INSERT INTO offer_enrichment(offer_id,source,outcome,attempts,attempted_at,isbn,facts_json,last_error)
       VALUES(?,?,?,1,?,?,?,?)
       ON CONFLICT(offer_id) DO UPDATE SET outcome=excluded.outcome, attempts=offer_enrichment.attempts+1,
         attempted_at=excluded.attempted_at, isbn=excluded.isbn, facts_json=excluded.facts_json, last_error=excluded.last_error`,
    )
    .run(offer.id, offer.source, outcome, at, isbn, facts ? JSON.stringify(facts) : null, error);
}

export async function enrichOffers(
  repository,
  {
    fetchHtml = (url, source) => readSourceHtml(url, { source }),
    sources,
    limit = 40,
    now = () => new Date(),
    signal = null,
    onProgress = () => {},
  } = {},
) {
  const report = { checked: 0, isbnFound: 0, noIsbn: 0, errors: 0, requeued: 0, stopped: null };
  for (const offer of pendingEnrichment(repository, { sources, limit, now })) {
    if (signal?.aborted) {
      report.stopped = 'aborted';
      break;
    }
    const at = now().toISOString();
    let html;
    try {
      html = await fetchHtml(offer.url, offer.source);
    } catch (error) {
      report.checked += 1;
      report.errors += 1;
      record(repository, offer, { outcome: 'error', error: String(error?.message ?? error).slice(0, 200) }, at);
      // A challenge or rate limit applies to the whole source: stop instead of hammering it.
      if (error?.blocked || error?.status === 429) {
        report.stopped = String(error.message);
        break;
      }
      continue;
    }
    report.checked += 1;
    const detail = parseProductDetail(html);
    const facts = { ...detail, isbn: undefined };
    if (!detail.isbn) {
      report.noIsbn += 1;
      record(repository, offer, { outcome: 'no_isbn', facts }, at);
    } else {
      repository.transaction(() => {
        repository.database
          .prepare("UPDATE offers SET observed_isbn=? WHERE id=? AND (observed_isbn IS NULL OR observed_isbn='')")
          .run(detail.isbn, offer.id);
        repository.putMetadataEvidence({
          id: stableId(offer.id, detail.isbn),
          offerId: offer.id,
          fieldName: 'isbn',
          value: detail.isbn,
          classification: 'structured',
          sourceType: `detail:${offer.source}`,
          verificationStatus: 'unverified',
          observedAt: at,
          at,
        });
        record(repository, offer, { outcome: 'isbn_found', isbn: detail.isbn, facts }, at);
        if (requeueForNewEvidence(repository, offer.id, at)) report.requeued += 1;
      });
      report.isbnFound += 1;
    }
    onProgress({ ...report });
  }
  return report;
}
