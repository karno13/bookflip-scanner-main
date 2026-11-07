// ISBN ↔ title consistency. Sellers often type the ISBN of a different book (or a scanner reads
// one from "recommended offers"), so an ISBN alone can file "Logik der Forschung" under Warcraft.
// The check is deliberately lenient: one shared word (title, series, universe or author surname)
// is enough. Only a listing that shares *nothing* with the record is held back for review.
import { titleTokens, fold } from './title-proposals.mjs';

// The same universe written two ways on covers and in BN records.
const SYNONYMS = [
  ['discworld', 'swiat dysku'],
  ['warhammer', '40000 40k'],
  ['horus heresy', 'herezja horusa'],
  ['forgotten realms', 'drizzt'],
];

const stem = (token) => token.slice(0, 5);

function stems(text) {
  let folded = fold(text);
  for (const [a, b] of SYNONYMS) {
    if (folded.includes(a)) folded += ' ' + b;
    if (folded.includes(b)) folded += ' ' + a;
  }
  return new Set(titleTokens(folded).filter((token) => !/^\d{1,3}$/.test(token)).map(stem));
}

function authorText(authors) {
  if (!authors) return '';
  if (typeof authors === 'string') {
    try {
      return [].concat(JSON.parse(authors)).join(' ');
    } catch {
      return authors;
    }
  }
  return [].concat(authors).join(' ');
}

/**
 * True when the offer title and the catalogue record have no word in common.
 * `record`: { title, workTitle?, authors? }. Offers without usable words ("Książka", "zestaw")
 * never conflict - there is nothing to compare.
 */
export function titleConflict(offerTitle, record = {}) {
  const offer = stems(offerTitle);
  if (!offer.size) return false;
  const known = stems([record.title, record.workTitle, authorText(record.authors)].filter(Boolean).join(' '));
  if (!known.size) return false;
  for (const token of offer) if (known.has(token)) return false;
  return true;
}

/** Active automatic assignments whose offer title shares nothing with the edition. */
export function findTitleConflicts(repository) {
  const rows = repository.database
    .prepare(
      `SELECT m.offer_id, m.edition_id, m.method, o.original_title, o.source, o.normalized_url, o.observed_isbn, o.image_url,
              e.title AS edition_title, e.work_id, w.title AS work_title, w.authors_json
       FROM offer_matches m
       JOIN offers o ON o.id = m.offer_id
       JOIN editions e ON e.id = m.edition_id
       JOIN works w ON w.id = e.work_id
       WHERE m.status = 'active' AND m.method NOT IN ('manual', 'legacy_manual')`,
    )
    .all();
  return rows
    .filter((row) =>
      titleConflict(row.original_title, { title: row.edition_title, workTitle: row.work_title, authors: row.authors_json }),
    )
    .map((row) => ({
      offerId: row.offer_id,
      editionId: row.edition_id,
      workId: row.work_id,
      offerTitle: row.original_title,
      source: row.source,
      url: row.normalized_url,
      isbn: row.observed_isbn,
      editionTitle: row.edition_title,
      workTitle: row.work_title,
    }));
}

/**
 * Operator decision on a suspicious assignment:
 * - "confirm": the ISBN is right after all - the assignment becomes manual and is not flagged again;
 * - "review": the assignment is withdrawn and the offer goes back to the review queue.
 */
export function resolveTitleConflict(repository, input = {}, { now = () => new Date() } = {}) {
  const offerId = String(input.offerId ?? '');
  const action = String(input.action ?? '');
  if (!['confirm', 'review'].includes(action))
    throw Object.assign(Error('INVALID_ACTION'), { statusCode: 400 });
  return repository.transaction(() => {
    const active = repository.database
      .prepare("SELECT * FROM offer_matches WHERE offer_id=? AND status='active'")
      .get(offerId);
    if (!active) throw Object.assign(Error('MATCH_NOT_FOUND'), { statusCode: 404 });
    const at = now().toISOString();
    if (action === 'confirm') {
      repository.assignOfferToEdition(offerId, active.edition_id, {
        id: `title_confirmed_${active.id}`,
        method: 'manual',
        status: 'active',
        reason: 'Potwierdzono ręcznie mimo niezgodnego tytułu ogłoszenia.',
        createdBy: 'local_user',
        at,
      });
      return { offerId, action, editionId: active.edition_id };
    }
    repository.database
      .prepare("UPDATE offer_matches SET status='superseded', valid_to=? WHERE offer_id=? AND status='active'")
      .run(at, offerId);
    const result = JSON.stringify({
      decision: 'review_required',
      reason: ['isbn_title_mismatch'],
      editionId: active.edition_id,
      withdrawnAt: at,
    });
    const job = repository.database
      .prepare("SELECT id FROM identification_jobs WHERE offer_id=? AND job_type='identify_edition'")
      .get(offerId);
    if (job)
      repository.database
        .prepare(
          "UPDATE identification_jobs SET status='review_required', run_after=NULL, lease_token=NULL, lease_expires_at=NULL, last_error=NULL, result_json=?, updated_at=? WHERE id=?",
        )
        .run(result, at, job.id);
    else
      repository.database
        .prepare(
          "INSERT INTO identification_jobs(id, offer_id, job_type, status, attempt_count, created_at, updated_at, result_json) VALUES(?, ?, 'identify_edition', 'review_required', 0, ?, ?, ?)",
        )
        .run(`title_conflict_${offerId}`, offerId, at, at, result);
    return { offerId, action, editionId: active.edition_id };
  });
}
