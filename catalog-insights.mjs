// Read-only overview of how complete the collected data is: the offer → ISBN → catalog funnel,
// data quality per source, completeness of catalog editions and progress per scan phrase.

const pct = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : 0);

export function catalogInsights(repository) {
  const db = repository.database;
  const hasIsbn = "((o.observed_isbn IS NOT NULL AND o.observed_isbn<>'') OR m.offer_id IS NOT NULL)";
  const activeMatch = `LEFT JOIN (SELECT DISTINCT offer_id FROM offer_matches WHERE status='active') m ON m.offer_id=o.id`;
  const funnelRow = db
    .prepare(
      `SELECT count(*) AS offers,
         sum(CASE WHEN ${hasIsbn} THEN 1 ELSE 0 END) AS withIsbn,
         sum(CASE WHEN m.offer_id IS NOT NULL THEN 1 ELSE 0 END) AS matched,
         sum(CASE WHEN o.image_url IS NOT NULL THEN 1 ELSE 0 END) AS withImage
       FROM offers o ${activeMatch}`,
    )
    .get();
  const manual = Number(
    db
      .prepare(
        "SELECT count(DISTINCT offer_id) AS c FROM offer_matches WHERE status='active' AND method IN ('manual','legacy_manual')",
      )
      .get().c,
  );
  const jobs = Object.fromEntries(
    db
      .prepare("SELECT status, count(*) AS c FROM identification_jobs WHERE job_type='identify_edition' GROUP BY status")
      .all()
      .map((row) => [row.status, Number(row.c)]),
  );
  const sets = Number(db.prepare('SELECT count(*) AS c FROM offer_sets').get().c);
  const offers = Number(funnelRow.offers || 0);
  const funnel = {
    offers,
    withIsbn: Number(funnelRow.withIsbn || 0),
    matched: Number(funnelRow.matched || 0),
    manual,
    withImage: Number(funnelRow.withImage || 0),
    review: jobs.review_required || 0,
    queued: (jobs.queued || 0) + (jobs.running || 0) + (jobs.retry_wait || 0),
    failed: jobs.failed || 0,
    sets,
  };

  const sources = db
    .prepare(
      `SELECT o.source, count(*) AS offers,
         sum(CASE WHEN ${hasIsbn} THEN 1 ELSE 0 END) AS withIsbn,
         sum(CASE WHEN m.offer_id IS NOT NULL THEN 1 ELSE 0 END) AS matched,
         sum(CASE WHEN o.image_url IS NOT NULL THEN 1 ELSE 0 END) AS withImage,
         sum(CASE WHEN o.first_seen_at >= ? THEN 1 ELSE 0 END) AS newThisWeek,
         max(o.last_seen_at) AS lastSeenAt
       FROM offers o ${activeMatch} GROUP BY o.source ORDER BY offers DESC`,
    )
    .all(new Date(Date.now() - 7 * 86400000).toISOString())
    .map((row) => ({
      source: row.source,
      offers: Number(row.offers),
      isbnRate: pct(Number(row.withIsbn), Number(row.offers)),
      matchRate: pct(Number(row.matched), Number(row.offers)),
      imageRate: pct(Number(row.withImage), Number(row.offers)),
      newThisWeek: Number(row.newThisWeek || 0),
      lastSeenAt: row.lastSeenAt,
    }));

  const editionRow = db
    .prepare(
      `SELECT count(*) AS editions,
         sum(CASE WHEN publication_year IS NOT NULL THEN 1 ELSE 0 END) AS withYear,
         sum(CASE WHEN publisher IS NOT NULL AND trim(publisher)<>'' THEN 1 ELSE 0 END) AS withPublisher,
         sum(CASE WHEN EXISTS (SELECT 1 FROM edition_identifiers i WHERE i.edition_id=e.id AND i.scheme LIKE 'isbn%') THEN 1 ELSE 0 END) AS withIsbn,
         sum(CASE WHEN EXISTS (SELECT 1 FROM offer_matches mm JOIN offers oo ON oo.id=mm.offer_id
               WHERE mm.edition_id=e.id AND mm.status='active' AND oo.image_url IS NOT NULL) THEN 1 ELSE 0 END) AS withCover,
         sum(CASE WHEN EXISTS (SELECT 1 FROM offer_matches mm WHERE mm.edition_id=e.id AND mm.status='active') THEN 1 ELSE 0 END) AS withOffers
       FROM editions e`,
    )
    .get();
  const works = Number(
    db
      .prepare('SELECT count(*) AS c FROM works w WHERE NOT EXISTS (SELECT 1 FROM catalog_work_merges cm WHERE cm.source_id=w.id)')
      .get().c,
  );
  const editions = Number(editionRow.editions || 0);
  const completeness = {
    works,
    editions,
    year: pct(Number(editionRow.withYear || 0), editions),
    publisher: pct(Number(editionRow.withPublisher || 0), editions),
    isbn: pct(Number(editionRow.withIsbn || 0), editions),
    cover: pct(Number(editionRow.withCover || 0), editions),
    withOffers: Number(editionRow.withOffers || 0),
  };

  // Scan phrases ≈ series the operator follows. Progress = offers already identified.
  const phrases = new Map();
  for (const row of db
    .prepare(
      `SELECT o.matched_queries_json AS queries, m.offer_id IS NOT NULL AS matched,
         EXISTS (SELECT 1 FROM identification_jobs j WHERE j.offer_id=o.id AND j.status='review_required') AS review
       FROM offers o ${activeMatch}`,
    )
    .all()) {
    let list = [];
    try {
      list = JSON.parse(row.queries || '[]');
    } catch {}
    const phrase = String(list[0] || '').trim();
    if (!phrase) continue;
    const key = phrase.toLocaleLowerCase('pl');
    const item = phrases.get(key) || { phrase, offers: 0, matched: 0, review: 0 };
    item.offers += 1;
    if (row.matched) item.matched += 1;
    if (row.review) item.review += 1;
    phrases.set(key, item);
  }
  const series = [...phrases.values()]
    .sort((a, b) => b.offers - a.offers)
    .slice(0, 12)
    .map((item) => ({ ...item, matchRate: pct(item.matched, item.offers) }));

  // Jobs waiting out a metadata outage, with the latest reason BN gave (expired certificate, HTTP 503…).
  const waiting = db
    .prepare(
      `SELECT count(*) AS n, min(run_after) AS nextRun,
         (SELECT json_extract(result_json,'$.evidence.bnError') FROM identification_jobs
            WHERE status='retry_wait' AND json_extract(result_json,'$.evidence.bnError') IS NOT NULL
            ORDER BY updated_at DESC LIMIT 1) AS reason
       FROM identification_jobs WHERE status='retry_wait' AND last_error='METADATA_TEMPORARY_ERROR'`,
    )
    .get();
  const outage = Number(waiting.n)
    ? { source: 'BN', waiting: Number(waiting.n), reason: waiting.reason || null, nextRun: waiting.nextRun }
    : null;
  return { funnel, sources, completeness, series, outage, generatedAt: new Date().toISOString() };
}
