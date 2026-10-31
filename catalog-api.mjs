import { createHash, randomUUID } from 'node:crypto';

const json = (value, fallback = null) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
const number = (value, fallback, min, max) => Number.isInteger(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const likeLiteral = value => `%${String(value).replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`;
const stableId = (prefix, ...values) => `${prefix}_${createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)}`;
const page = (options = {}) => ({ limit: number(options.limit, 100, 1, 250), offset: number(options.offset, 0, 0, 1_000_000), query: String(options.query ?? '').trim().toLowerCase() });

function identifierMap(database, editionIds) {
  const result = new Map();
  if (!editionIds.length) return result;
  const rows = database.prepare(`SELECT edition_id,scheme,normalized_value,source,verification_status FROM edition_identifiers
    WHERE edition_id IN (${editionIds.map(() => '?').join(',')}) ORDER BY scheme,normalized_value`).all(...editionIds);
  for (const row of rows) {
    if (!result.has(row.edition_id)) result.set(row.edition_id, []);
    result.get(row.edition_id).push({ scheme: row.scheme, value: row.normalized_value, source: row.source, verificationStatus: row.verification_status });
  }
  return result;
}

function offer(row) {
  return row && { id: row.id, legacyId: row.legacy_id, source: row.source, externalOfferId: row.external_offer_id, url: row.normalized_url,
    title: row.original_title, currentPrice: row.current_price, currency: row.currency, availability: row.availability, language: row.language,
    observedIsbn: row.observed_isbn, matchedQueries: json(row.matched_queries_json, []), firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at, seenCount: row.seen_count };
}

export function listCatalogWorks(repository, options = {}) {
  const { database } = repository, { limit, offset, query } = page(options), like = likeLiteral(query);
  const where = query ? `WHERE lower(w.title) LIKE ? ESCAPE '!' OR lower(w.authors_json) LIKE ? ESCAPE '!' OR EXISTS (
    SELECT 1 FROM editions se JOIN edition_identifiers si ON si.edition_id=se.id WHERE se.work_id=w.id AND lower(si.normalized_value) LIKE ? ESCAPE '!')` : '';
  const params = query ? [like, like, like] : [];
  const total = Number(database.prepare(`SELECT count(*) AS count FROM works w ${where}`).get(...params).count);
  const works = database.prepare(`SELECT w.*,
    (SELECT count(*) FROM editions e WHERE e.work_id=w.id) AS edition_count,
    (SELECT count(*) FROM offer_matches m JOIN editions e ON e.id=m.edition_id WHERE e.work_id=w.id AND m.status='active') AS offer_count
    FROM works w ${where} ORDER BY lower(w.title),w.id LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const editionRows = works.length ? database.prepare(`SELECT * FROM editions WHERE work_id IN (${works.map(() => '?').join(',')}) ORDER BY publication_year,title`).all(...works.map((row) => row.id)) : [];
  const identifiers = identifierMap(database, editionRows.map((row) => row.id)), byWork = new Map();
  for (const row of editionRows) {
    if (!byWork.has(row.work_id)) byWork.set(row.work_id, []);
    byWork.get(row.work_id).push({ id: row.id, title: row.title, publisher: row.publisher, publicationYear: row.publication_year, language: row.language, binding: row.binding, verificationStatus: row.verification_status, identifiers: identifiers.get(row.id) ?? [] });
  }
  return { total, limit, offset, items: works.map((row) => ({ id: row.id, legacyId: row.legacy_id, title: row.title, authors: json(row.authors_json, []), verificationStatus: row.verification_status, editionCount: Number(row.edition_count), offerCount: Number(row.offer_count), editions: byWork.get(row.id) ?? [] })) };
}

export function getCatalogWork(repository, workId) {
  const { database } = repository, row = database.prepare('SELECT * FROM works WHERE id=?').get(String(workId));
  if (!row) return null;
  const editions = database.prepare('SELECT * FROM editions WHERE work_id=? ORDER BY publication_year,title').all(row.id);
  const identifiers = identifierMap(database, editions.map((item) => item.id));
  const external = database.prepare(`SELECT DISTINCT r.provider,r.external_id,r.record_type,r.status,r.fetched_at,r.payload_hash
    FROM external_records r LEFT JOIN external_record_links l ON l.external_record_id=r.id
    WHERE COALESCE(r.work_id,l.work_id)=? ORDER BY r.fetched_at DESC`).all(row.id);
  return { id: row.id, legacyId: row.legacy_id, title: row.title, authors: json(row.authors_json, []), verificationStatus: row.verification_status,
    editions: editions.map((item) => ({ id: item.id, title: item.title, publisher: item.publisher, publicationYear: item.publication_year,
      language: item.language, binding: item.binding, verificationStatus: item.verification_status, identifiers: identifiers.get(item.id) ?? [],
      activeOfferCount: Number(database.prepare("SELECT count(*) AS count FROM offer_matches WHERE edition_id=? AND status='active'").get(item.id).count) })),
    externalRecords: external.map((item) => ({ provider: item.provider, externalId: item.external_id, recordType: item.record_type, status: item.status, fetchedAt: item.fetched_at, payloadHash: item.payload_hash })) };
}

export function getCatalogEdition(repository, editionId) {
  const { database } = repository, row = database.prepare(`SELECT e.*,w.title AS work_title,w.authors_json FROM editions e JOIN works w ON w.id=e.work_id WHERE e.id=?`).get(String(editionId));
  if (!row) return null;
  const offers = database.prepare(`SELECT o.*,m.method,m.valid_from FROM offer_matches m JOIN offers o ON o.id=m.offer_id WHERE m.edition_id=? AND m.status='active' ORDER BY o.last_seen_at DESC`).all(row.id);
  const records = database.prepare(`SELECT DISTINCT r.provider,r.external_id,r.record_type,r.status,r.fetched_at,r.payload_hash
    FROM external_records r LEFT JOIN external_record_links l ON l.external_record_id=r.id WHERE COALESCE(r.edition_id,l.edition_id)=? ORDER BY r.fetched_at DESC`).all(row.id);
  return { id: row.id, workId: row.work_id, workTitle: row.work_title, authors: json(row.authors_json, []), title: row.title, publisher: row.publisher,
    publicationYear: row.publication_year, language: row.language, binding: row.binding, verificationStatus: row.verification_status,
    identifiers: identifierMap(database, [row.id]).get(row.id) ?? [], offers: offers.map((item) => ({ ...offer(item), method: item.method, matchedAt: item.valid_from })),
    externalRecords: records.map((item) => ({ provider: item.provider, externalId: item.external_id, recordType: item.record_type, status: item.status, fetchedAt: item.fetched_at, payloadHash: item.payload_hash })) };
}

export function listCatalogOffers(repository, options = {}) {
  const { database } = repository, { limit, offset, query } = page(options), conditions = [], params = [], status = String(options.status ?? ''), source = String(options.source ?? '');
  if (query) { conditions.push("(lower(o.original_title) LIKE ? ESCAPE '!' OR lower(o.observed_isbn) LIKE ? ESCAPE '!' OR lower(o.source) LIKE ? ESCAPE '!')"); params.push(likeLiteral(query), likeLiteral(query), likeLiteral(query)); }
  if (source) { conditions.push('o.source=?'); params.push(source); }
  if (status === 'matched') conditions.push('m.id IS NOT NULL');
  if (status === 'review') conditions.push("j.status IN ('queued','running','retry_wait','review_required','failed')");
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const from = `FROM offers o LEFT JOIN offer_matches m ON m.offer_id=o.id AND m.status='active'
    LEFT JOIN editions e ON e.id=m.edition_id LEFT JOIN works w ON w.id=e.work_id
    LEFT JOIN identification_jobs j ON j.offer_id=o.id AND j.job_type='identify_edition'`;
  const total = Number(database.prepare(`SELECT count(DISTINCT o.id) AS count ${from} ${where}`).get(...params).count);
  const offerSort = {
    newest: 'o.last_seen_at DESC,o.id',
    title: 'lower(o.original_title),o.id',
    'price-asc': 'o.current_price IS NULL,o.current_price ASC,o.id',
    'price-desc': 'o.current_price IS NULL,o.current_price DESC,o.id',
  };
  const orderBy=offerSort[String(options.sort||'newest')]||offerSort.newest;
  const rows = database.prepare(`SELECT o.*,m.id AS match_id,m.method,e.id AS edition_id,e.title AS edition_title,w.title AS work_title,j.id AS job_id,j.status AS job_status
    ${from} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, limit, offset, items: rows.map((row) => ({ ...offer(row), match: row.match_id ? { id: row.match_id, method: row.method, editionId: row.edition_id, editionTitle: row.edition_title, workTitle: row.work_title } : null, identification: row.job_id ? { jobId: row.job_id, status: row.job_status } : null })) };
}

export function getCatalogOffer(repository, offerId) {
  const { database } = repository, row = database.prepare('SELECT * FROM offers WHERE id=?').get(String(offerId));
  if (!row) return null;
  const evidence = database.prepare('SELECT * FROM metadata_evidence WHERE offer_id=? ORDER BY observed_at,id').all(row.id);
  const matches = database.prepare(`SELECT m.*,e.title AS edition_title,w.title AS work_title FROM offer_matches m JOIN editions e ON e.id=m.edition_id JOIN works w ON w.id=e.work_id WHERE m.offer_id=? ORDER BY m.valid_from,m.id`).all(row.id);
  const job = database.prepare("SELECT * FROM identification_jobs WHERE offer_id=? AND job_type='identify_edition'").get(row.id) ?? null;
  const decisions = database.prepare('SELECT * FROM review_decisions WHERE offer_id=? ORDER BY created_at,id').all(row.id);
  return { ...offer(row), priceHistory: database.prepare('SELECT price,observed_at FROM offer_price_history WHERE offer_id=? ORDER BY observed_at').all(row.id).map((item) => ({ price: item.price, observedAt: item.observed_at })),
    evidence: evidence.map((item) => ({ id: item.id, fieldName: item.field_name, value: json(item.value_json), classification: item.classification, sourceType: item.source_type, verificationStatus: item.verification_status, observedAt: item.observed_at })),
    matches: matches.map((item) => ({ id: item.id, editionId: item.edition_id, editionTitle: item.edition_title, workTitle: item.work_title, method: item.method, status: item.status, reason: json(item.reason, item.reason), createdBy: item.created_by, validFrom: item.valid_from, validTo: item.valid_to })),
    identificationJob: job ? { id: job.id, status: job.status, attemptCount: job.attempt_count, lastError: job.last_error, result: json(job.result_json), updatedAt: job.updated_at } : null,
    decisions: decisions.map((item) => ({ id: item.id, action: item.action, editionId: item.edition_id, reason: item.reason, createdBy: item.created_by, createdAt: item.created_at })) };
}

export function listIdentificationJobs(repository, options = {}) {
  const { database } = repository, { limit, offset, query } = page(options), conditions = [], params = [], status = String(options.status ?? ''), source = String(options.source ?? '');
  conditions.push(status ? 'j.status=?' : "j.status IN ('queued','running','retry_wait','review_required','failed')"); if (status) params.push(status);
  if (source) { conditions.push('o.source=?'); params.push(source); }
  const isbn=String(options.isbn||'');
  if(isbn==='present')conditions.push("o.observed_isbn IS NOT NULL AND o.observed_isbn<>''");
  if(isbn==='missing')conditions.push("o.observed_isbn IS NULL OR o.observed_isbn=''");
  if (query) { conditions.push("(lower(o.original_title) LIKE ? ESCAPE '!' OR lower(o.observed_isbn) LIKE ? ESCAPE '!' OR lower(o.source) LIKE ? ESCAPE '!')"); params.push(likeLiteral(query), likeLiteral(query), likeLiteral(query)); }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = Number(database.prepare(`SELECT count(*) AS count FROM identification_jobs j JOIN offers o ON o.id=j.offer_id ${where}`).get(...params).count);
  const orderBy=options.sort==='price'?'o.current_price ASC,j.id':'CASE j.status WHEN \'review_required\' THEN 0 WHEN \'failed\' THEN 1 ELSE 2 END,j.updated_at DESC,j.id';
  const rows = database.prepare(`SELECT j.*,o.source,o.original_title,o.current_price,o.currency,o.normalized_url,o.observed_isbn,o.last_seen_at
    FROM identification_jobs j JOIN offers o ON o.id=j.offer_id ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, limit, offset, items: rows.map((row) => ({ id: row.id, offerId: row.offer_id, status: row.status, attemptCount: row.attempt_count,
    lastError: row.last_error, result: json(row.result_json), updatedAt: row.updated_at,
    offer: { id: row.offer_id, source: row.source, title: row.original_title, currentPrice: row.current_price, currency: row.currency, url: row.normalized_url, observedIsbn: row.observed_isbn, lastSeenAt: row.last_seen_at } })) };
}

export function decideIdentificationJob(repository, jobId, input = {}, { now = () => new Date(), idFactory = randomUUID } = {}) {
  const action = String(input.action ?? '');
  if (!['approved', 'proposal_rejected', 'not_book', 'requeued'].includes(action)) throw Object.assign(Error('INVALID_REVIEW_ACTION'), { statusCode: 400 });
  return repository.transaction(() => {
    const job = repository.database.prepare('SELECT * FROM identification_jobs WHERE id=?').get(String(jobId));
    if (!job) throw Object.assign(Error('IDENTIFICATION_JOB_NOT_FOUND'), { statusCode: 404 });
    const at = now().toISOString(), editionId = input.editionId ? String(input.editionId) : null;
    const active = repository.database.prepare("SELECT * FROM offer_matches WHERE offer_id=? AND status='active'").get(job.offer_id);
    if (active && ['manual', 'legacy_manual'].includes(active.method) && (action !== 'approved' || active.edition_id !== editionId)) throw Object.assign(Error('MANUAL_ASSIGNMENT_PROTECTED'), { statusCode: 409 });
    if (action === 'approved') {
      if (!editionId || !repository.database.prepare('SELECT id FROM editions WHERE id=?').get(editionId)) throw Object.assign(Error('EDITION_NOT_FOUND'), { statusCode: 404 });
      if (!active || active.edition_id !== editionId || !['manual', 'legacy_manual'].includes(active.method)) repository.assignOfferToEdition(job.offer_id, editionId, { id: stableId('manual_match', job.offer_id, editionId, at), method: 'manual', status: 'active', reason: String(input.reason ?? 'Zatwierdzone ręcznie w lokalnym interfejsie.'), createdBy: 'local_user', at });
    }
    if (action === 'proposal_rejected' && editionId) repository.assignOfferToEdition(job.offer_id, editionId, { id: stableId('rejected_match', job.offer_id, editionId, at), method: 'metadata', status: 'rejected', reason: String(input.reason ?? 'Propozycja odrzucona ręcznie.'), createdBy: 'local_user', at });
    const decisionId = String(input.id ?? idFactory());
    repository.database.prepare('INSERT INTO review_decisions(id,job_id,offer_id,edition_id,action,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(decisionId, job.id, job.offer_id, editionId, action, input.reason ? String(input.reason) : null, 'local_user', at);
    const status = ['approved', 'not_book'].includes(action) ? 'completed' : action === 'requeued' ? 'queued' : 'review_required';
    const result = { manualDecision: action, editionId, reason: input.reason ?? null, decidedAt: at };
    repository.database.prepare('UPDATE identification_jobs SET status=?,run_after=NULL,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,result_json=?,updated_at=? WHERE id=?').run(status, JSON.stringify(result), at, job.id);
    return { decision: { id: decisionId, action, editionId, createdAt: at }, job: { ...repository.database.prepare('SELECT * FROM identification_jobs WHERE id=?').get(job.id), result } };
  });
}
