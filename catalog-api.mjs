import { normalizeISBN } from './isbn-normalization.mjs';
import { createHash, randomUUID } from 'node:crypto';

const json = (value, fallback = null) => {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};
const number = (value, fallback, min, max) =>
  Number.isInteger(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const likeLiteral = (value) =>
  `%${String(value).replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`;
const stableId = (prefix, ...values) =>
  `${prefix}_${createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)}`;
const page = (options = {}) => ({
  limit: number(options.limit, 100, 1, 250),
  offset: number(options.offset, 0, 0, 1_000_000),
  query: String(options.query ?? '')
    .trim()
    .normalize('NFC').toLocaleLowerCase('pl'),
});

function identifierMap(database, editionIds) {
  const result = new Map();
  if (!editionIds.length) return result;
  const rows = database
    .prepare(
      `SELECT edition_id,scheme,normalized_value,source,verification_status FROM edition_identifiers
    WHERE edition_id IN (${editionIds.map(() => '?').join(',')}) ORDER BY scheme,normalized_value`,
    )
    .all(...editionIds);
  for (const row of rows) {
    if (!result.has(row.edition_id)) result.set(row.edition_id, []);
    result
      .get(row.edition_id)
      .push({
        scheme: row.scheme,
        value: row.normalized_value,
        source: row.source,
        verificationStatus: row.verification_status,
      });
  }
  return result;
}

function offer(row) {
  return (
    row && {
      id: row.id,
      legacyId: row.legacy_id,
      source: row.source,
      externalOfferId: row.external_offer_id,
      url: row.normalized_url,
      title: row.original_title,
      currentPrice: row.current_price,
      currency: row.currency,
      availability: row.availability,
      language: row.language,
      observedIsbn: row.observed_isbn,
      matchedQueries: json(row.matched_queries_json, []),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      seenCount: row.seen_count,
    }
  );
}

export function listCatalogWorks(repository, options = {}) {
  const { database } = repository,
    { limit, offset, query } = page(options),
    like = likeLiteral(query);
  const conditions = ["NOT EXISTS (SELECT 1 FROM catalog_work_merges cm WHERE cm.source_id=w.id)"];
  const params = [];
  if (query) {
    conditions.push("(bookflip_fold(w.title) LIKE ? ESCAPE '!' OR bookflip_fold(w.authors_json) LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM editions se JOIN edition_identifiers si ON si.edition_id=se.id WHERE se.work_id=w.id AND bookflip_fold(si.normalized_value) LIKE ? ESCAPE '!'))");
    params.push(like,like,like);
  }
  const editionFilters=[];
  for(const [key,column] of [['language','language'],['publisher','publisher'],['binding','binding']]) {
    if(options[key]) {editionFilters.push('bookflip_fold(fe.'+column+')=bookflip_fold(?)');params.push(String(options[key]));}
  }
  if(options.year) {editionFilters.push('fe.publication_year=?');params.push(Number(options.year));}
  if(editionFilters.length) conditions.push('EXISTS (SELECT 1 FROM editions fe WHERE fe.work_id=w.id AND '+editionFilters.join(' AND ')+')');
  const where = 'WHERE '+conditions.join(' AND ');
  const total = Number(
    database.prepare(`SELECT count(*) AS count FROM works w ${where}`).get(...params).count,
  );
  const works = database
    .prepare(
      `SELECT w.*,
    (SELECT count(*) FROM editions e WHERE e.work_id=w.id) AS edition_count,
    (SELECT count(*) FROM offer_matches m JOIN editions e ON e.id=m.edition_id WHERE e.work_id=w.id AND m.status='active') AS offer_count
    FROM works w ${where} ORDER BY ${options.sort === 'offers' ? 'offer_count DESC,bookflip_fold(w.title),w.id' : options.sort === 'recent' ? 'w.updated_at DESC,w.id' : 'bookflip_fold(w.title),w.id'} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const editionRows = works.length
    ? database
        .prepare(
          `SELECT * FROM editions WHERE work_id IN (${works.map(() => '?').join(',')}) ORDER BY publication_year,title`,
        )
        .all(...works.map((row) => row.id))
    : [];
  const identifiers = identifierMap(
      database,
      editionRows.map((row) => row.id),
    ),
    byWork = new Map();
  for (const row of editionRows) {
    if (!byWork.has(row.work_id)) byWork.set(row.work_id, []);
    byWork
      .get(row.work_id)
      .push({
        id: row.id,
        title: row.title,
        publisher: row.publisher,
        publicationYear: row.publication_year,
        language: row.language,
        binding: row.binding,
        verificationStatus: row.verification_status,
        identifiers: identifiers.get(row.id) ?? [],
      });
  }
  return {
    total,
    limit,
    offset,
    items: works.map((row) => ({
      id: row.id,
      legacyId: row.legacy_id,
      title: row.title,
      authors: json(row.authors_json, []),
      verificationStatus: row.verification_status,
      editionCount: Number(row.edition_count),
      offerCount: Number(row.offer_count),
      editions: byWork.get(row.id) ?? [],
    })),
  };
}

export function getCatalogWork(repository, workId) {
  const alias=repository.database.prepare('SELECT target_id FROM catalog_work_merges WHERE source_id=?').get(String(workId));
  if(alias) return getCatalogWork(repository,alias.target_id);
  const { database } = repository,
    row = database.prepare('SELECT * FROM works WHERE id=?').get(String(workId));
  if (!row) return null;
  const editions = database
    .prepare('SELECT * FROM editions WHERE work_id=? ORDER BY publication_year,title')
    .all(row.id);
  const identifiers = identifierMap(
    database,
    editions.map((item) => item.id),
  );
  const external = database
    .prepare(
      `SELECT DISTINCT r.provider,r.external_id,r.record_type,r.status,r.fetched_at,r.payload_hash
    FROM external_records r LEFT JOIN external_record_links l ON l.external_record_id=r.id
    WHERE COALESCE(r.work_id,l.work_id)=? ORDER BY r.fetched_at DESC`,
    )
    .all(row.id);
  return {
    id: row.id,
    legacyId: row.legacy_id,
    title: row.title,
    authors: json(row.authors_json, []),
    verificationStatus: row.verification_status,
    editions: editions.map((item) => ({
      id: item.id,
      title: item.title,
      publisher: item.publisher,
      publicationYear: item.publication_year,
      language: item.language,
      binding: item.binding,
      verificationStatus: item.verification_status,
      identifiers: identifiers.get(item.id) ?? [],
      activeOfferCount: Number(
        database
          .prepare(
            "SELECT count(*) AS count FROM offer_matches WHERE edition_id=? AND status='active'",
          )
          .get(item.id).count,
      ),
    })),
    externalRecords: external.map((item) => ({
      provider: item.provider,
      externalId: item.external_id,
      recordType: item.record_type,
      status: item.status,
      fetchedAt: item.fetched_at,
      payloadHash: item.payload_hash,
    })),
  };
}

export function getCatalogEdition(repository, editionId) {
  const { database } = repository,
    row = database
      .prepare(
        `SELECT e.*,w.title AS work_title,w.authors_json FROM editions e JOIN works w ON w.id=e.work_id WHERE e.id=?`,
      )
      .get(String(editionId));
  if (!row) return null;
  const offers = database
    .prepare(
      `SELECT o.*,m.method,m.valid_from FROM offer_matches m JOIN offers o ON o.id=m.offer_id WHERE m.edition_id=? AND m.status='active' ORDER BY o.last_seen_at DESC`,
    )
    .all(row.id);
  const records = database
    .prepare(
      `SELECT DISTINCT r.provider,r.external_id,r.record_type,r.status,r.fetched_at,r.payload_hash
    FROM external_records r LEFT JOIN external_record_links l ON l.external_record_id=r.id WHERE COALESCE(r.edition_id,l.edition_id)=? ORDER BY r.fetched_at DESC`,
    )
    .all(row.id);
  return {
    id: row.id,
    workId: row.work_id,
    workTitle: row.work_title,
    authors: json(row.authors_json, []),
    title: row.title,
    publisher: row.publisher,
    publicationYear: row.publication_year,
    language: row.language,
    binding: row.binding,
    verificationStatus: row.verification_status,
    identifiers: identifierMap(database, [row.id]).get(row.id) ?? [],
    offers: offers.map((item) => ({
      ...offer(item),
      method: item.method,
      matchedAt: item.valid_from,
    })),
    externalRecords: records.map((item) => ({
      provider: item.provider,
      externalId: item.external_id,
      recordType: item.record_type,
      status: item.status,
      fetchedAt: item.fetched_at,
      payloadHash: item.payload_hash,
    })),
  };
}

export function listCatalogOffers(repository, options = {}) {
  const { database } = repository,
    { limit, offset, query } = page(options),
    conditions = [],
    params = [],
    status = String(options.status ?? ''),
    source = String(options.source ?? '');
  if (query) {
    conditions.push(
      "(bookflip_fold(o.original_title) LIKE ? ESCAPE '!' OR bookflip_fold(o.observed_isbn) LIKE ? ESCAPE '!' OR bookflip_fold(o.source) LIKE ? ESCAPE '!')",
    );
    params.push(likeLiteral(query), likeLiteral(query), likeLiteral(query));
  }
  if (source) {
    conditions.push('o.source=?');
    params.push(source);
  }
  if (status === 'matched') conditions.push('m.id IS NOT NULL');
  if (status === 'review')
    conditions.push("j.status IN ('queued','running','retry_wait','review_required','failed')");
  if (options.watched === '1') conditions.push('ow.watched=1');
  if (options.target === '1') conditions.push("ow.watched=1 AND ow.target_price IS NOT NULL AND o.currency='PLN' AND o.current_price<=round(ow.target_price*100)");
  if (options.purchaseStatus) {conditions.push('ow.purchase_status=?');params.push(String(options.purchaseStatus));}
  if (options.scan) {
    conditions.push('EXISTS (SELECT 1 FROM scan_offer_results sr WHERE sr.offer_id=o.id AND sr.scanned_at=?'+
      (options.scanChange==='new'?' AND sr.is_new=1':options.scanChange==='price'?' AND sr.price_changed=1':'')+')');
    params.push(String(options.scan));
  }
  for (const [key,operator] of [['minPrice','>='],['maxPrice','<=']]) {
    if (options[key]!==undefined && options[key]!=='') {
      const value=Number(options[key]);
      if(!Number.isFinite(value)||value<0||value>100000000) throw Object.assign(Error('INVALID_PRICE_FILTER'),{statusCode:400});
      conditions.push("o.currency='PLN' AND o.current_price"+operator+'?');params.push(Math.round(value*100));
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const from = `FROM offers o LEFT JOIN offer_workspace ow ON ow.offer_id=o.id LEFT JOIN offer_scenarios scenario ON scenario.offer_id=o.id LEFT JOIN offer_matches m ON m.offer_id=o.id AND m.status='active'
    LEFT JOIN editions e ON e.id=m.edition_id LEFT JOIN works w ON w.id=e.work_id
    LEFT JOIN identification_jobs j ON j.id = (
      SELECT j2.id FROM identification_jobs j2
      WHERE j2.offer_id=o.id AND j2.job_type='identify_edition'
      ORDER BY j2.created_at DESC,j2.id DESC LIMIT 1
    )`;
  const total = Number(
    database.prepare(`SELECT count(DISTINCT o.id) AS count ${from} ${where}`).get(...params).count,
  );
  const offerSort = {
    newest: 'o.last_seen_at DESC,o.id',
    oldest: 'o.last_seen_at ASC,o.id',
    title: 'bookflip_fold(o.original_title) ASC,o.id',
    'title-desc': 'bookflip_fold(o.original_title) DESC,o.id',
    source: 'bookflip_fold(o.source) ASC,o.id',
    'source-desc': 'bookflip_fold(o.source) DESC,o.id',
    'price-asc': 'o.current_price IS NULL,o.current_price ASC,o.id',
    'price-desc': 'o.current_price IS NULL,o.current_price DESC,o.id',
  };
  const orderBy = offerSort[String(options.sort || 'newest')] || offerSort.newest;
  const rows = database
    .prepare(
      `SELECT o.*,ow.purchase_status,ow.watched,ow.target_price,scenario.actual_purchase,m.id AS match_id,m.method,e.id AS edition_id,e.title AS edition_title,w.title AS work_title,j.id AS job_id,j.status AS job_status
    ${from} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  return {
    total,
    limit,
    offset,
    items: rows.map((row) => ({
      ...offer(row),
      purchaseStatus:row.purchase_status || null,watched:Boolean(row.watched),targetPrice:row.target_price ?? null,
      actualPurchase:row.actual_purchase ?? null,
      targetReached:Boolean(row.watched && row.target_price!==null && row.currency==='PLN' && row.current_price!==null && row.current_price<=Math.round(row.target_price*100)),
      match: row.match_id
        ? {
            id: row.match_id,
            method: row.method,
            editionId: row.edition_id,
            editionTitle: row.edition_title,
            workTitle: row.work_title,
          }
        : null,
      identification: row.job_id ? { jobId: row.job_id, status: row.job_status } : null,
    })),
  };
}

export function getCatalogOffer(repository, offerId) {
  const { database } = repository,
    row = database.prepare('SELECT * FROM offers WHERE id=?').get(String(offerId));
  if (!row) return null;
  const evidence = database
    .prepare('SELECT * FROM metadata_evidence WHERE offer_id=? ORDER BY observed_at,id')
    .all(row.id);
  const matches = database
    .prepare(
      `SELECT m.*,e.title AS edition_title,w.title AS work_title FROM offer_matches m JOIN editions e ON e.id=m.edition_id JOIN works w ON w.id=e.work_id WHERE m.offer_id=? ORDER BY m.valid_from,m.id`,
    )
    .all(row.id);
  const job =
    database
      .prepare("SELECT * FROM identification_jobs WHERE offer_id=? AND job_type='identify_edition'")
      .get(row.id) ?? null;
  const decisions = database
    .prepare('SELECT * FROM review_decisions WHERE offer_id=? ORDER BY created_at,id')
    .all(row.id);
  return {
    ...offer(row),
    priceHistory: database
      .prepare(
        'SELECT price,observed_at FROM offer_price_history WHERE offer_id=? ORDER BY observed_at',
      )
      .all(row.id)
      .map((item) => ({ price: item.price, observedAt: item.observed_at })),
    evidence: evidence.map((item) => ({
      id: item.id,
      fieldName: item.field_name,
      value: json(item.value_json),
      classification: item.classification,
      sourceType: item.source_type,
      verificationStatus: item.verification_status,
      observedAt: item.observed_at,
    })),
    matches: matches.map((item) => ({
      id: item.id,
      editionId: item.edition_id,
      editionTitle: item.edition_title,
      workTitle: item.work_title,
      method: item.method,
      status: item.status,
      reason: json(item.reason, item.reason),
      createdBy: item.created_by,
      validFrom: item.valid_from,
      validTo: item.valid_to,
    })),
    identificationJob: job
      ? {
          id: job.id,
          status: job.status,
          attemptCount: job.attempt_count,
          lastError: job.last_error,
          result: json(job.result_json),
          updatedAt: job.updated_at,
        }
      : null,
    decisions: decisions.map((item) => ({
      id: item.id,
      action: item.action,
      editionId: item.edition_id,
      reason: item.reason,
      createdBy: item.created_by,
      createdAt: item.created_at,
    })),
  };
}

export function listIdentificationJobs(repository, options = {}) {
  const { database } = repository,
    { limit, offset, query } = page(options),
    conditions = [],
    params = [],
    status = String(options.status ?? ''),
    source = String(options.source ?? '');
  conditions.push(
    status
      ? 'j.status=?'
      : "j.status IN ('queued','running','retry_wait','review_required','failed')",
  );
  if (status) params.push(status);
  if(options.offerId){conditions.push('o.id=?');params.push(String(options.offerId));}
  if (source) {
    conditions.push('o.source=?');
    params.push(source);
  }
  const isbn = String(options.isbn || '');
  if (isbn === 'present') conditions.push("o.observed_isbn IS NOT NULL AND o.observed_isbn<>''");
  if (isbn === 'missing') conditions.push("(o.observed_isbn IS NULL OR o.observed_isbn='')");
  if (query) {
    conditions.push(
      "(bookflip_fold(o.original_title) LIKE ? ESCAPE '!' OR bookflip_fold(o.observed_isbn) LIKE ? ESCAPE '!' OR bookflip_fold(o.source) LIKE ? ESCAPE '!')",
    );
    params.push(likeLiteral(query), likeLiteral(query), likeLiteral(query));
  }
  if(options.scan) { conditions.push('EXISTS (SELECT 1 FROM scan_offer_results sr WHERE sr.offer_id=o.id AND sr.scanned_at=?)');params.push(String(options.scan)); }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = Number(
    database
      .prepare(
        `SELECT count(*) AS count FROM identification_jobs j JOIN offers o ON o.id=j.offer_id ${where}`,
      )
      .get(...params).count,
  );
  const orderBy =
    options.sort === 'price'
      ? 'o.current_price ASC,j.id'
      : options.sort === 'proposal'
      ? "CASE p.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,p.best_score DESC,j.id"
      : "CASE j.status WHEN 'review_required' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,j.updated_at DESC,j.id";
  const rows = database
    .prepare(
      `SELECT j.*,o.source,o.original_title,o.current_price,o.currency,o.normalized_url,o.observed_isbn,o.last_seen_at,o.availability,
      p.confidence AS proposal_confidence,p.best_isbn AS proposal_isbn,p.best_score AS proposal_score
    FROM identification_jobs j JOIN offers o ON o.id=j.offer_id LEFT JOIN title_proposals p ON p.job_id=j.id
    ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  return {
    total,
    limit,
    offset,
    items: rows.map((row) => ({
      id: row.id,
      offerId: row.offer_id,
      status: row.status,
      attemptCount: row.attempt_count,
      lastError: row.last_error,
      result: json(row.result_json),
      updatedAt: row.updated_at,
      proposal: row.proposal_confidence
        ? { confidence: row.proposal_confidence, isbn: row.proposal_isbn, score: row.proposal_score }
        : null,
      offer: {
        id: row.offer_id,
        source: row.source,
        title: row.original_title,
        currentPrice: row.current_price,
        currency: row.currency,
        url: row.normalized_url,
        observedIsbn: row.observed_isbn,
        lastSeenAt: row.last_seen_at,
        availability: row.availability,
      },
    })),
  };
}

/**
 * Resolve a reviewed ISBN against the local catalog and metadata providers,
 * with the original offer context. Unlike catalog-only lookup this can attach
 * the offer, but never silently overrides a manual assignment.
 */
export async function matchIdentificationJobByIsbn(
  catalog,
  jobId,
  input = {},
  { now = () => new Date() } = {},
) {
  const repository = catalog.repository;
  const job = repository.database
    .prepare('SELECT id,offer_id,status FROM identification_jobs WHERE id=?')
    .get(String(jobId));
  if (!job) throw Object.assign(Error('IDENTIFICATION_JOB_NOT_FOUND'), { statusCode: 404 });
  if (job.status !== 'review_required')
    throw Object.assign(Error('REVIEW_JOB_NOT_PENDING'), { statusCode: 409 });
  const offer = repository.database.prepare(
    'SELECT observed_isbn FROM offers WHERE id=?',
  ).get(job.offer_id);
  const raw = String(input.isbn ?? offer?.observed_isbn ?? '').trim();
  if (!raw) throw Object.assign(Error('ISBN_REQUIRED'), { statusCode: 400 });
  const isbn = normalizeISBN(raw);
  if (!isbn) throw Object.assign(Error('INVALID_ISBN'), { statusCode: 400 });
  if (input.preview === true) {
    const existing = repository.findEditionByISBN(isbn);
    if (existing) return {
      isbn, preview: true, matched: false, canConfirm: true, source: 'catalog',
      editionId: existing.id, candidate: getCatalogEdition(repository, existing.id),
    };
  }
  // A typed ISBN is an explicit operator assertion, not evidence extracted
  // from an unrelated advertisement. Matching uses ISBN alone.
  const result = await catalog.resolver.resolve({
    offerId: job.offer_id,
    dryRun: input.preview === true,
    evidence: {
      status: 'valid',
      values: [isbn],
      isbn,
      candidateIsbn: isbn,
      classification: 'structured',
      autoAssignable: true,
      reviewRequired: false,
      observations: [{ value: isbn, classification: 'structured', source: 'review:operator' }],
    },
  });
  const matched = ['matched_existing', 'created_edition', 'created_work_and_edition']
    .includes(result.decision);
  if(input.preview===true) {
    const existing=repository.findEditionByISBN(isbn);
    return {...result,isbn,preview:true,canConfirm:matched,matched:false,
      source: existing ? 'catalog' : 'api',
      candidate:existing ? getCatalogEdition(repository,existing.id) : result.candidate ?? null};
  }
  if(input.confirm===true && matched) {
    decideIdentificationJob(repository,job.id,{action:'approved',editionId:result.editionId,reason:'Zatwierdzono po podglądzie dopasowania ISBN.'});
    return {...result,isbn,matched:true,status:'completed'};
  }
  const at = now().toISOString();
  // Do not mark the job completed for temporary API errors, missing metadata,
  // or mismatched bibliographic information.
  const saved = repository.database.prepare(
    "UPDATE identification_jobs SET status=?,result_json=?,updated_at=?,last_error=NULL WHERE id=? AND status='review_required'",
  ).run(matched ? 'completed' : 'review_required', JSON.stringify(result), at, job.id);
  if (Number(saved.changes) !== 1)
    throw Object.assign(Error('REVIEW_JOB_CHANGED'), { statusCode: 409 });
  return { ...result, isbn, matched, status: matched ? 'completed' : 'review_required' };
}

export function decideIdentificationJob(
  repository,
  jobId,
  input = {},
  { now = () => new Date(), idFactory = randomUUID } = {},
) {
  const action = String(input.action ?? '');
  if (!['approved', 'proposal_rejected', 'not_book', 'excluded', 'requeued'].includes(action))
    throw Object.assign(Error('INVALID_REVIEW_ACTION'), { statusCode: 400 });
  return repository.transaction(() => {
    const job = repository.database
      .prepare('SELECT * FROM identification_jobs WHERE id=?')
      .get(String(jobId));
    if (!job) throw Object.assign(Error('IDENTIFICATION_JOB_NOT_FOUND'), { statusCode: 404 });
    const at = now().toISOString(),
      editionId = input.editionId ? String(input.editionId) : null;
    const active = repository.database
      .prepare("SELECT * FROM offer_matches WHERE offer_id=? AND status='active'")
      .get(job.offer_id);
    if (
      active &&
      ['manual', 'legacy_manual'].includes(active.method) &&
      (action !== 'approved' || active.edition_id !== editionId)
    )
      throw Object.assign(Error('MANUAL_ASSIGNMENT_PROTECTED'), { statusCode: 409 });
    if (['not_book', 'excluded'].includes(action) && active)
      repository.database.prepare(
        "UPDATE offer_matches SET status='superseded',valid_to=? WHERE offer_id=? AND status='active'",
      ).run(at, job.offer_id);
    if (action === 'approved') {
      if (
        !editionId ||
        !repository.database.prepare('SELECT id FROM editions WHERE id=?').get(editionId)
      )
        throw Object.assign(Error('EDITION_NOT_FOUND'), { statusCode: 404 });
      if (
        !active ||
        active.edition_id !== editionId ||
        !['manual', 'legacy_manual'].includes(active.method)
      )
        repository.assignOfferToEdition(job.offer_id, editionId, {
          id: stableId('manual_match', job.offer_id, editionId, at),
          method: 'manual',
          status: 'active',
          reason: String(input.reason ?? 'Zatwierdzone ręcznie w lokalnym interfejsie.'),
          createdBy: 'local_user',
          at,
        });
    }
    if (action === 'proposal_rejected' && editionId)
      repository.assignOfferToEdition(job.offer_id, editionId, {
        id: stableId('rejected_match', job.offer_id, editionId, at),
        method: 'metadata',
        status: 'rejected',
        reason: String(input.reason ?? 'Propozycja odrzucona ręcznie.'),
        createdBy: 'local_user',
        at,
      });
    const decisionId = String(input.id ?? idFactory());
    repository.database
      .prepare(
        'INSERT INTO review_decisions(id,job_id,offer_id,edition_id,action,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        decisionId,
        job.id,
        job.offer_id,
        editionId,
        action,
        input.reason ? String(input.reason) : null,
        'local_user',
        at,
      );
    const status = ['approved', 'not_book', 'excluded'].includes(action)
      ? 'completed'
      : action === 'requeued'
        ? 'queued'
        : 'review_required';
    const result = {
      manualDecision: action,
      editionId,
      reason: input.reason ?? null,
      decidedAt: at,
    };
    repository.database
      .prepare(
        'UPDATE identification_jobs SET status=?,run_after=NULL,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,attempt_count=CASE WHEN ?=1 THEN 0 ELSE attempt_count END,result_json=?,updated_at=? WHERE id=?',
      )
      .run(status, action === 'requeued' ? 1 : 0, JSON.stringify(result), at, job.id);
    return {
      decision: { id: decisionId, action, editionId, createdAt: at },
      job: {
        ...repository.database.prepare('SELECT * FROM identification_jobs WHERE id=?').get(job.id),
        result,
      },
    };
  });
}
