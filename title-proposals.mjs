// Suggests catalogue editions for offers that have no ISBN, using only the offer's title.
// The result is advice for the operator: it is stored and displayed, never applied automatically
// (the same work exists in many editions, translations and ISBNs).

const STOP = new Set([
  'w', 'i', 'z', 'na', 'do', 'od', 'po', 'za', 'ze', 'o', 'a', 'the', 'of', 'and', 'oraz', 'dla', 'czyli',
]);
// Words sellers add that are not part of the bibliographic title.
const SELLER_NOISE = new Set([
  'ksiazka', 'ksiazki', 'ksiazek', 'nowa', 'nowe', 'nowy', 'uzywana', 'uzywane', 'stan', 'bdb', 'idealny',
  'okazja', 'wysylka', 'gratis', 'polecam', 'wydanie', 'wyd', 'pierwsze', 'polskie', 'twarda', 'miekka',
  'oprawa', 'okladka', 'unikat', 'rzadkosc', 'kolekcjonerskie',
]);
// Universe / brand names that appear on the cover but rarely in the catalogued title.
const BRAND = new Set(['warhammer', '40000', '40k', 'warcraft', 'world', 'dragonlance', 'forgotten', 'realms']);

export const fold = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const VOLUME = /\b(?:tom|t|czesc|cz|vol|book|ksiega)\.?\s*(\d{1,3})\b/;

export function extractVolume(title) {
  const match = fold(title).match(VOLUME);
  return match ? Number(match[1]) : null;
}

/** Significant words of a title, for comparison. */
export function titleTokens(title, { dropBrand = false } = {}) {
  return [
    ...new Set(
      fold(title)
        .replace(VOLUME, ' ')
        .split(' ')
        .filter(
          (token) =>
            token.length > 1 &&
            !STOP.has(token) &&
            !SELLER_NOISE.has(token) &&
            !/^\d{4}$/.test(token) &&
            !(dropBrand && BRAND.has(token)),
        ),
    ),
  ];
}

/**
 * Search phrases for a catalogue title lookup, most specific first. Offers read like
 * "Herezja Horusa Vulkan Żyje | Dan Abnett | Warhammer 40K", the catalogue has "Vulkan żyje".
 */
export function searchVariants(offerTitle, { max = 4 } = {}) {
  const cleaned = String(offerTitle ?? '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(?:tom|t\.?|cz[eę]ść|vol\.?)\s*\d{1,3}\b/gi, ' ')
    .replace(/[“”"„]/g, ' ');
  const out = [];
  const add = (phrase) => {
    const text = phrase.replace(/\s+/g, ' ').trim();
    if (fold(text).length >= 4 && titleTokens(text).length && !out.some((x) => fold(x) === fold(text))) out.push(text);
  };
  const words = cleaned.split(/\s+/).filter(Boolean);
  const withoutBrand = (list) => list.filter((word) => !BRAND.has(fold(word)));
  const brand = words.find((word) => BRAND.has(fold(word))) ?? '';
  add(cleaned);
  // Sellers append the author ("... Warcraft Christie Golden"); catalogue titles do not contain it.
  if (words.length >= 5) add(words.slice(0, -2).join(' '));
  const pieces = cleaned.split(/\s[-–—|]\s|\s*[|:.]\s+/).map((piece) => piece.trim()).filter(Boolean);
  if (pieces.length > 1)
    for (const piece of pieces) {
      const own = withoutBrand(piece.split(/\s+/));
      if (own.length >= 2) {
        add(own.join(' '));
        if (brand) add(own.join(' ') + ' ' + brand);
      }
    }
  add(withoutBrand(words).join(' '));
  return out.slice(0, max);
}

function candidateTokenSets(candidate) {
  // BN: "Para w ruch / Raising steam, Discworld series" -> main title before the slash.
  const [main, rest = ''] = String(candidate.title ?? '').split(' / ');
  return { main: titleTokens(main), other: titleTokens(rest) };
}

function candidateVolume(candidate) {
  const match = fold(candidate.title).match(/\b(?:t|tom|cz|czesc)\s*(\d{1,3})\b/);
  return match ? Number(match[1]) : null;
}

/** 0..1 confidence that `candidate` is the book named by `offerTitle`. */
export function scoreCandidate(offerTitle, candidate) {
  const offer = new Set(titleTokens(offerTitle));
  const { main } = candidateTokenSets(candidate);
  if (!main.length || !offer.size) return 0;
  const hit = main.filter((token) => offer.has(token)).length;
  const candidateCoverage = hit / main.length;
  const offerCoverage = hit / offer.size;
  let score = 0.75 * candidateCoverage + 0.25 * Math.min(1, offerCoverage * 1.6);
  const wanted = extractVolume(offerTitle);
  const found = candidateVolume(candidate);
  if (wanted != null && found != null) score = wanted === found ? Math.min(1, score + 0.08) : score * 0.4;
  // The author written in the listing is a strong confirmation.
  const authorWords = titleTokens(candidate.authorText ?? (candidate.authors ?? []).join(' '));
  const surnames = authorWords.slice(0, 2);
  if (surnames.some((word) => word.length > 3 && offer.has(word))) score = Math.min(1, score + 0.07);
  if (candidate.language && !/pol/i.test(candidate.language)) score *= 0.7;
  return Math.round(score * 100) / 100;
}

export function rankCandidates(offerTitle, candidates, { limit = 6 } = {}) {
  const ranked = candidates
    .map((candidate) => ({ ...candidate, score: scoreCandidate(offerTitle, candidate) }))
    .filter((candidate) => candidate.score >= 0.35)
    .sort((a, b) => b.score - a.score || String(b.publicationYear).localeCompare(String(a.publicationYear)));
  const best = ranked[0];
  let confidence = 'none';
  if (best) {
    // Rivals with a different title make a proposal ambiguous; other editions of the same book do not.
    const rival = ranked.find(
      (candidate) =>
        fold(String(candidate.title).split(' / ')[0]) !== fold(String(best.title).split(' / ')[0]) &&
        candidate.score > best.score - 0.15,
    );
    confidence = best.score >= 0.85 && !rival ? 'high' : best.score >= 0.6 ? 'medium' : 'low';
  }
  return { candidates: ranked.slice(0, limit), confidence };
}

export function saveProposal(repository, job, { queries, candidates, confidence }, now = () => new Date()) {
  const best = candidates[0] ?? null;
  repository.database
    .prepare(
      `INSERT INTO title_proposals(job_id,offer_id,computed_at,queries_json,candidates_json,best_isbn,best_score,confidence)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(job_id) DO UPDATE SET computed_at=excluded.computed_at, queries_json=excluded.queries_json,
         candidates_json=excluded.candidates_json, best_isbn=excluded.best_isbn, best_score=excluded.best_score,
         confidence=excluded.confidence`,
    )
    .run(
      job.id,
      job.offer_id,
      now().toISOString(),
      JSON.stringify(queries),
      JSON.stringify(candidates),
      best?.isbn ?? null,
      best?.score ?? null,
      confidence,
    );
}

export function loadProposal(repository, jobId) {
  const row = repository.database.prepare('SELECT * FROM title_proposals WHERE job_id=?').get(jobId);
  return row
    ? {
        jobId,
        computedAt: row.computed_at,
        queries: JSON.parse(row.queries_json),
        candidates: JSON.parse(row.candidates_json),
        confidence: row.confidence,
      }
    : null;
}

/** Looks the offer's title up in the national catalogue and stores ranked proposals. */
export async function computeProposal(catalog, job, { now = () => new Date(), maxQueries = 3 } = {}) {
  const queries = searchVariants(job.original_title, { max: maxQueries });
  const pool = new Map();
  const unavailable = new Set();
  for (const query of queries) {
    let result;
    try {
      result = await catalog.findIsbnsByTitle(query);
    } catch (error) {
      if (error?.statusCode === 400) continue;
      throw error;
    }
    for (const source of result.unavailable ?? []) unavailable.add(source);
    for (const candidate of result.candidates ?? []) if (!pool.has(candidate.isbn)) pool.set(candidate.isbn, candidate);
    // A confident hit on the first phrase needs no further requests.
    if (rankCandidates(job.original_title, [...pool.values()]).confidence === 'high') break;
  }
  const ranked = rankCandidates(job.original_title, [...pool.values()]);
  // Do not cache an empty answer that is only the result of a source outage.
  if (!ranked.candidates.length && unavailable.size) return { ...ranked, queries, unavailable: [...unavailable], stored: false };
  saveProposal(catalog.repository, job, { queries, ...ranked }, now);
  return { ...ranked, queries, unavailable: [...unavailable], stored: true };
}

/** Jobs waiting for a decision that have no ISBN and no stored proposal yet. */
export function jobsNeedingProposal(repository, { limit = 10 } = {}) {
  return repository.database
    .prepare(
      `SELECT j.id, j.offer_id, o.original_title
       FROM identification_jobs j JOIN offers o ON o.id = j.offer_id
       LEFT JOIN title_proposals p ON p.job_id = j.id
       WHERE j.status = 'review_required' AND (o.observed_isbn IS NULL OR o.observed_isbn = '')
         AND p.job_id IS NULL AND length(o.original_title) >= 4
       ORDER BY o.last_seen_at DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.min(200, limit)));
}

export async function refreshProposals(catalog, { limit = 5, now, signal = null } = {}) {
  const report = { computed: 0, high: 0, medium: 0, none: 0, unavailable: false };
  for (const job of jobsNeedingProposal(catalog.repository, { limit })) {
    if (signal?.aborted) break;
    const result = await computeProposal(catalog, job, { now });
    if (!result.stored) {
      report.unavailable = true;
      break;
    }
    report.computed += 1;
    if (result.confidence === 'high') report.high += 1;
    else if (result.confidence === 'medium') report.medium += 1;
    else if (result.confidence === 'none') report.none += 1;
  }
  return report;
}
