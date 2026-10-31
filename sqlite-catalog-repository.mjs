import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CatalogRepository } from './catalog-repository.mjs';
import { applyCatalogMigrations } from './catalog-migrations.mjs';
import { isbnKeys, normalizeISBN } from './isbn-normalization.mjs';

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}
function json(value, fallback = []) {
  return JSON.stringify(value ?? fallback);
}
function integer(value, name, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (!Number.isSafeInteger(value)) throw Error(`INVALID_${name}`);
  return value;
}
function identifier(scheme, value) {
  const normalizedScheme = String(scheme || '').toLowerCase(),
    raw = String(value || '').trim();
  if (normalizedScheme === 'isbn10' || normalizedScheme === 'isbn13') {
    const normalized = normalizeISBN(raw);
    if (!normalized || normalized.length !== (normalizedScheme === 'isbn10' ? 10 : 13))
      throw Error('INVALID_EDITION_IDENTIFIER');
    return { scheme: normalizedScheme, value: normalized };
  }
  if (!['open_library', 'bn', 'other'].includes(normalizedScheme) || !raw || raw.length > 300)
    throw Error('INVALID_EDITION_IDENTIFIER');
  return { scheme: normalizedScheme, value: raw };
}

export class SqliteCatalogRepository extends CatalogRepository {
  constructor(
    path,
    { busyTimeout = 5000, wal = true, now = () => new Date(), idFactory = randomUUID } = {},
  ) {
    super();
    this.path = path;
    this.now = now;
    this.idFactory = idFactory;
    this.depth = 0;
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.database = new DatabaseSync(path);
    const timeout = Math.max(0, Math.min(60000, Number(busyTimeout) || 0));
    this.database.exec('PRAGMA foreign_keys=ON');
    this.database.exec(`PRAGMA busy_timeout=${timeout}`);
    if (wal && path !== ':memory:') this.database.exec('PRAGMA journal_mode=WAL');
    applyCatalogMigrations(this.database, { now: this.now });
    if (Number(this.database.prepare('PRAGMA foreign_keys').get().foreign_keys) !== 1)
      throw Error('SQLITE_FOREIGN_KEYS_DISABLED');
  }

  close() {
    this.database.close();
  }
  transaction(work) {
    const nested = this.depth > 0,
      savepoint = `catalog_${this.depth}`;
    this.database.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = work(this);
      if (result && typeof result.then === 'function')
        throw Error('ASYNC_TRANSACTION_NOT_SUPPORTED');
      this.depth--;
      this.database.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
      return result;
    } catch (error) {
      this.depth--;
      try {
        this.database.exec(nested ? `ROLLBACK TO SAVEPOINT ${savepoint}` : 'ROLLBACK');
        if (nested) this.database.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } catch {}
      throw error;
    }
  }

  createWork(input = {}) {
    const at = iso(input.at || this.now()),
      legacyId = input.legacyId == null ? null : String(input.legacyId),
      existing = legacyId
        ? this.database.prepare('SELECT * FROM works WHERE legacy_id=?').get(legacyId)
        : null;
    if (existing) return { ...existing, created: false };
    const id = String(input.id || this.idFactory()),
      title = String(input.title || '').trim();
    this.database
      .prepare(
        `INSERT INTO works(id,legacy_id,title,normalized_title,authors_json,verification_status,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        legacyId,
        title,
        input.normalizedTitle || null,
        json(input.authors),
        input.verificationStatus || 'unverified',
        at,
        at,
      );
    return { ...this.database.prepare('SELECT * FROM works WHERE id=?').get(id), created: true };
  }

  createEdition(input = {}) {
    const at = iso(input.at || this.now()),
      legacyId = input.legacyId == null ? null : String(input.legacyId),
      existing = legacyId
        ? this.database.prepare('SELECT * FROM editions WHERE legacy_id=?').get(legacyId)
        : null;
    if (existing) return { ...existing, created: false };
    const id = String(input.id || this.idFactory()),
      title = String(input.title || '').trim();
    this.database
      .prepare(
        `INSERT INTO editions(id,work_id,legacy_id,title,publisher,publication_year,language,binding,verification_status,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.workId,
        legacyId,
        title,
        input.publisher || null,
        integer(input.publicationYear, 'PUBLICATION_YEAR', { nullable: true }),
        input.language || null,
        input.binding || null,
        input.verificationStatus || 'unverified',
        at,
        at,
      );
    return { ...this.database.prepare('SELECT * FROM editions WHERE id=?').get(id), created: true };
  }

  attachIdentifier(
    editionId,
    scheme,
    value,
    { source = 'local', verificationStatus = 'unverified', at = this.now() } = {},
  ) {
    const normalized = identifier(scheme, value),
      existing = this.database
        .prepare('SELECT * FROM edition_identifiers WHERE scheme=? AND normalized_value=?')
        .get(normalized.scheme, normalized.value);
    if (existing && existing.edition_id !== editionId) throw Error('EDITION_IDENTIFIER_CONFLICT');
    if (existing) return { ...existing, created: false };
    const result = this.database
      .prepare(
        `INSERT INTO edition_identifiers(edition_id,scheme,normalized_value,source,verification_status,created_at)
   VALUES(?,?,?,?,?,?)`,
      )
      .run(
        editionId,
        normalized.scheme,
        normalized.value,
        String(source),
        verificationStatus,
        iso(at),
      );
    return {
      ...this.database
        .prepare('SELECT * FROM edition_identifiers WHERE id=?')
        .get(result.lastInsertRowid),
      created: true,
    };
  }

  findEditionByISBN(value) {
    const keys = isbnKeys(value);
    if (!keys.length) return null;
    const rows = this.database
      .prepare(
        `SELECT DISTINCT e.*,w.title AS work_title,w.legacy_id AS work_legacy_id
   FROM edition_identifiers i JOIN editions e ON e.id=i.edition_id JOIN works w ON w.id=e.work_id
   WHERE (i.scheme='isbn10' OR i.scheme='isbn13') AND i.normalized_value IN (${keys.map(() => '?').join(',')})`,
      )
      .all(...keys);
    if (rows.length > 1) throw Error('ISBN_EDITION_CONFLICT');
    if (!rows.length) return null;
    return {
      ...rows[0],
      identifiers: this.database
        .prepare(
          'SELECT scheme,normalized_value,source,verification_status FROM edition_identifiers WHERE edition_id=? ORDER BY scheme,normalized_value',
        )
        .all(rows[0].id),
    };
  }

  findWorkByExternalId(provider, externalId) {
    return (
      this.database
        .prepare(
          `SELECT w.* FROM external_records r JOIN works w ON w.id=r.work_id
   WHERE r.provider=? AND r.external_id=? AND r.work_id IS NOT NULL ORDER BY r.fetched_at DESC LIMIT 1`,
        )
        .get(provider, externalId) || null
    );
  }

  createEditionForISBN({
    workId,
    isbn,
    title,
    legacyId = null,
    verificationStatus = 'unverified',
    source = 'local',
    at = this.now(),
  }) {
    return this.transaction(() => {
      const found = this.findEditionByISBN(isbn);
      if (found) return { ...found, created: false };
      const edition = this.createEdition({ workId, title, legacyId, verificationStatus, at }),
        normalized = normalizeISBN(isbn),
        scheme = normalized.length === 10 ? 'isbn10' : 'isbn13';
      this.attachIdentifier(edition.id, scheme, normalized, { source, verificationStatus, at });
      return { ...this.findEditionByISBN(normalized), created: edition.created };
    });
  }

  upsertOffer(input = {}) {
    const source = String(input.source || ''),
      external = input.externalOfferId == null ? null : String(input.externalOfferId),
      url = String(input.normalizedUrl || input.url || ''),
      requestedId = String(input.id || input.legacyId || '');
    let old = requestedId
      ? this.database.prepare('SELECT * FROM offers WHERE id=?').get(requestedId)
      : null;
    if (!old && external)
      old = this.database
        .prepare('SELECT * FROM offers WHERE source=? AND external_offer_id=?')
        .get(source, external);
    if (!old && external)
      old = this.database
        .prepare(
          'SELECT * FROM offers WHERE source=? AND normalized_url=? AND external_offer_id IS NULL',
        )
        .get(source, url);
    if (!old && !external)
      old = this.database
        .prepare(
          'SELECT * FROM offers WHERE source=? AND normalized_url=? ORDER BY external_offer_id IS NULL DESC LIMIT 1',
        )
        .get(source, url);
    const at = iso(input.at || this.now()),
      id = old?.id || requestedId || this.idFactory(),
      legacyId = input.legacyId == null ? old?.legacy_id || null : String(input.legacyId),
      title = String(input.originalTitle ?? input.title ?? old?.original_title ?? '').slice(0, 500),
      price = input.currentPrice ?? input.price ?? old?.current_price ?? null;
    if (price != null) integer(price, 'OFFER_PRICE');
    if (old) {
      this.database
        .prepare(
          `UPDATE offers SET legacy_id=COALESCE(legacy_id,?),external_offer_id=COALESCE(external_offer_id,?),original_title=?,current_price=?,currency=?,availability=?,language=COALESCE(?,language),observed_isbn=COALESCE(?,observed_isbn),matched_queries_json=?,first_seen_at=COALESCE(first_seen_at,?),last_seen_at=?,seen_count=?,updated_at=? WHERE id=?`,
        )
        .run(
          legacyId,
          external,
          title,
          price,
          input.currency || old.currency || 'PLN',
          input.availability || old.availability || 'unconfirmed',
          input.language ?? null,
          input.observedIsbn ?? input.isbn ?? null,
          json(input.matchedQueries ?? JSON.parse(old.matched_queries_json || '[]')),
          input.firstSeenAt || old.first_seen_at || at,
          input.lastSeenAt || at,
          input.seenCount ?? Number(old.seen_count || 0) + 1,
          at,
          id,
        );
      return {
        ...this.database.prepare('SELECT * FROM offers WHERE id=?').get(id),
        created: false,
      };
    }
    this.database
      .prepare(
        `INSERT INTO offers(id,legacy_id,source,external_offer_id,normalized_url,original_title,current_price,currency,availability,language,observed_isbn,matched_queries_json,first_seen_at,last_seen_at,seen_count,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        legacyId,
        source,
        external,
        url,
        title,
        price,
        input.currency || 'PLN',
        input.availability || 'unconfirmed',
        input.language || null,
        input.observedIsbn ?? input.isbn ?? null,
        json(input.matchedQueries),
        input.firstSeenAt || at,
        input.lastSeenAt || at,
        input.seenCount ?? 1,
        at,
        at,
      );
    return { ...this.database.prepare('SELECT * FROM offers WHERE id=?').get(id), created: true };
  }

  appendPriceObservation(offerId, price, observedAt) {
    integer(price, 'OFFER_PRICE');
    const previous = this.database
      .prepare(
        'SELECT price FROM offer_price_history WHERE offer_id=? ORDER BY observed_at DESC,id DESC LIMIT 1',
      )
      .get(offerId);
    if (previous && Number(previous.price) === price) return { created: false };
    const result = this.database
      .prepare(
        'INSERT OR IGNORE INTO offer_price_history(offer_id,price,observed_at) VALUES(?,?,?)',
      )
      .run(offerId, price, iso(observedAt));
    return { created: Number(result.changes) === 1 };
  }

  assignOfferToEdition(offerId, editionId, options = {}) {
    const id = options.id || this.idFactory(),
      method = options.method || 'metadata',
      status = options.status || 'active';
    return this.transaction(() => {
      const existing = this.database.prepare('SELECT * FROM offer_matches WHERE id=?').get(id);
      if (existing) return { ...existing, created: false };
      const timestamp = iso(options.at || this.now());
      if (status === 'active')
        this.database
          .prepare(
            `UPDATE offer_matches SET status='superseded',valid_to=? WHERE offer_id=? AND status='active'`,
          )
          .run(timestamp, offerId);
      this.database
        .prepare(
          'INSERT INTO offer_matches(id,offer_id,edition_id,method,status,confidence,reason,created_by,valid_from,valid_to,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          offerId,
          editionId,
          method,
          status,
          options.confidence ?? null,
          options.reason || null,
          options.createdBy || 'system',
          timestamp,
          null,
          timestamp,
        );
      return {
        ...this.database.prepare('SELECT * FROM offer_matches WHERE id=?').get(id),
        created: true,
      };
    });
  }

  getOfferMatchHistory(offerId) {
    return this.database
      .prepare('SELECT * FROM offer_matches WHERE offer_id=? ORDER BY valid_from,id')
      .all(offerId);
  }

  putMetadataEvidence(input = {}) {
    const id = String(input.id || this.idFactory()),
      at = iso(input.at || this.now());
    const result = this.database
      .prepare(
        'INSERT OR IGNORE INTO metadata_evidence(id,work_id,edition_id,offer_id,external_record_id,field_name,value_json,classification,source_type,verification_status,observed_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        input.workId || null,
        input.editionId || null,
        input.offerId || null,
        input.externalRecordId || null,
        input.fieldName,
        json(input.value, null),
        input.classification || 'legacy',
        input.sourceType || 'local',
        input.verificationStatus || 'unverified',
        iso(input.observedAt || at),
        at,
      );
    return {
      ...this.database.prepare('SELECT * FROM metadata_evidence WHERE id=?').get(id),
      created: Number(result.changes) === 1,
    };
  }

  putExternalRecord(input = {}) {
    const id = String(input.id || this.idFactory()),
      at = iso(input.at || this.now());
    const result = this.database
      .prepare(
        'INSERT OR IGNORE INTO external_records(id,provider,external_id,record_type,work_id,edition_id,status,payload_json,payload_hash,fetched_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        input.provider,
        input.externalId,
        input.recordType || 'unknown',
        input.workId || null,
        input.editionId || null,
        input.status || 'found',
        input.payload == null ? null : json(input.payload, null),
        input.payloadHash,
        input.fetchedAt ? iso(input.fetchedAt) : at,
        at,
      );
    return {
      ...this.database.prepare('SELECT * FROM external_records WHERE id=?').get(id),
      created: Number(result.changes) === 1,
    };
  }

  putIdentificationJob(input = {}) {
    const id = String(input.id || this.idFactory()),
      at = iso(input.at || this.now()),
      jobType = input.jobType || 'identify_edition';
    const result = this.database
      .prepare(
        'INSERT OR IGNORE INTO identification_jobs(id,offer_id,job_type,status,attempt_count,run_after,lease_token,lease_expires_at,last_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        input.offerId,
        jobType,
        input.status || 'queued',
        input.attemptCount || 0,
        input.runAfter ? iso(input.runAfter) : null,
        input.leaseToken || null,
        input.leaseExpiresAt ? iso(input.leaseExpiresAt) : null,
        input.lastError || null,
        at,
        at,
      );
    const row = this.database
      .prepare('SELECT * FROM identification_jobs WHERE offer_id=? AND job_type=?')
      .get(input.offerId, jobType);
    return { ...row, created: Number(result.changes) === 1 };
  }

  getIdentificationStatus(offerId) {
    return {
      job:
        this.database
          .prepare(
            'SELECT * FROM identification_jobs WHERE offer_id=? ORDER BY created_at DESC LIMIT 1',
          )
          .get(offerId) || null,
      matches: this.getOfferMatchHistory(offerId),
    };
  }

  counts() {
    const tables = [
      'works',
      'editions',
      'edition_identifiers',
      'offers',
      'offer_price_history',
      'offer_matches',
      'external_records',
      'metadata_evidence',
      'identification_jobs',
    ];
    return Object.fromEntries(
      tables.map((table) => [
        table,
        Number(this.database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count),
      ]),
    );
  }
}
