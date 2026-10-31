import { createHash } from 'node:crypto';
import {fileURLToPath} from 'node:url';

import { CatalogResolver } from './catalog-resolver.mjs';
import { IdentificationWorker } from './identification-worker.mjs';
import { createBnAdapter } from './metadata-sources/bn.mjs';
import { createOpenLibraryAdapter } from './metadata-sources/open-library.mjs';
import { SourceRateLimiter } from './metadata-http.mjs';
import { lookupISBN, SqliteMetadataCache } from './metadata-lookup.mjs';
import { extractOfferISBN } from './isbn.mjs';
import { identifyOffer } from './offer-identity.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

function stableId(prefix, ...values) {
  return `${prefix}_${createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)}`;
}

function integerPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? Math.round(price) : null;
}

export function productionCatalogEnabled(environment = process.env) {
  return !['0', 'false', 'off', 'no'].includes(String(environment.BOOKFLIP_CATALOG_ENABLED ?? '1').toLowerCase());
}

export function createProductionCatalog({
  databasePath = process.env.BOOKFLIP_CATALOG_DB ?? fileURLToPath(new URL('./scan-results/bookflip-catalog.sqlite',import.meta.url)),
  fetcher = globalThis.fetch,
  contact = process.env.BOOKFLIP_OPEN_LIBRARY_CONTACT ?? 'bookflip-local@localhost',
  now = () => new Date(),
  busyTimeout = 10_000,
} = {}) {
  const repository = new SqliteCatalogRepository(databasePath, { busyTimeout, now });
  const bnAdapter = createBnAdapter({
    fetcher,
    limiter: new SourceRateLimiter({ minIntervalMs: 1_000 }),
    timeoutMs: Number(process.env.BOOKFLIP_METADATA_TIMEOUT_MS ?? 8_000),
  });
  const openLibraryAdapter = createOpenLibraryAdapter({
    fetcher,
    limiter: new SourceRateLimiter({ minIntervalMs: 1_000 }),
    timeoutMs: Number(process.env.BOOKFLIP_METADATA_TIMEOUT_MS ?? 8_000),
    userAgent: `BookFlip/2.0 (catalog resolver; ${contact})`,
  });
  const cache = new SqliteMetadataCache(repository, { now });
  const resolver = new CatalogResolver({
    repository,
    now,
    lookupMetadata: (isbn) => lookupISBN(isbn, {
      bnAdapter,
      openLibraryAdapter,
      cache,
    }),
  });
  const worker = new IdentificationWorker({
    repository,
    resolver,
    now,
    leaseMs: Number(process.env.BOOKFLIP_CATALOG_LEASE_MS ?? 60_000),
    retryDelayMs: Number(process.env.BOOKFLIP_CATALOG_RETRY_MS ?? 300_000),
  });

  return {
    repository,
    resolver,
    worker,
    lookupIsbn(isbn) {
      return lookupISBN(isbn, { bnAdapter, openLibraryAdapter, cache });
    },
    resolveIsbn(isbn, { dryRun = false } = {}) {
      return resolver.resolve({ evidence: {
        status: 'valid', values: [isbn], isbn, candidateIsbn: isbn,
        classification: 'structured', autoAssignable: true, reviewRequired: false, observations: [],
      }, dryRun });
    },
    ingestOffers(offers, observedAt = now(), {jsonMirror=null,scanSummary=null} = {}) {
      const report = { offers: 0, evidence: 0, jobs: 0, skipped: 0 };
      const at = observedAt instanceof Date ? observedAt.toISOString() : String(observedAt);
      repository.transaction(() => {
        for (const offer of offers ?? []) {
          let identity;
          try { identity = identifyOffer(offer); } catch { report.skipped += 1; continue; }
          const price = integerPrice(offer.price ?? offer.currentPrice);
          const stored = repository.upsertOffer({
            id: identity.id,
            source: identity.source,
            externalOfferId: identity.externalId,
            normalizedUrl: identity.url,
            originalTitle: offer.title ?? offer.originalTitle ?? '',
            currentPrice: price,
            currency: offer.currency ?? 'PLN',
            availability: offer.availability ?? 'unconfirmed',
            language: offer.language ?? null,
            observedIsbn: offer.isbn ?? null,
            matchedQueries: offer.matchedQueries ?? [],
            firstSeenAt: offer.firstSeenAt ?? at,
            lastSeenAt: offer.lastSeenAt ?? at,
            seenCount: Number.isSafeInteger(offer.seenCount) && offer.seenCount > 0 ? offer.seenCount : undefined,
            at: observedAt,
          });
          if (price != null) repository.appendPriceObservation(stored.id, price, observedAt);
          report.offers += 1;

          const evidence = extractOfferISBN(offer);
          for (const observation of evidence.observations.filter((row) => row.valid)) {
            const value = observation.value;
            const evidenceId = stableId('scan_isbn', stored.id, value, observation.classification);
            const saved = repository.putMetadataEvidence({
              id: evidenceId,
              offerId: stored.id,
              fieldName: 'isbn',
              value,
              classification: observation.classification,
              sourceType: `scanner:${identity.source}`,
              verificationStatus: 'unverified',
              observedAt,
              at: observedAt,
            });
            if (saved.created) report.evidence += 1;
          }
          const job = repository.putIdentificationJob({ offerId: stored.id, status: 'queued', at: observedAt });
          if (job.created) report.jobs += 1;
        }
        if(scanSummary){
          if(scanSummary.at!==at)throw Error('INVALID_SCAN_SUMMARY_TIME');
          repository.database.prepare("INSERT OR REPLACE INTO scan_runs(scanned_at,summary_json,created_at) VALUES(?,?,?)")
            .run(at,JSON.stringify(scanSummary),at);
        }
        if(jsonMirror){
          if(typeof jsonMirror.id!=='string'||!jsonMirror.id||typeof jsonMirror.snapshot!=='object')throw Error('INVALID_SCAN_MIRROR');
          repository.database.prepare(`INSERT INTO scan_json_mirror_outbox(id,snapshot_json,scanned_at,status,created_at)
            VALUES(?,?,?,'pending',?)`).run(jsonMirror.id,JSON.stringify(jsonMirror.snapshot),at,at);
        }
      });
      return report;
    },
    completeJsonMirror(id) {
      const changed=repository.database.prepare("UPDATE scan_json_mirror_outbox SET status='completed',completed_at=? WHERE id=? AND status='pending'").run(now().toISOString(),id);
      if(Number(changed.changes)!==1)throw Error('JSON_MIRROR_CHECKPOINT_MISSING');
      repository.database.prepare("DELETE FROM scan_json_mirror_outbox WHERE status='completed' AND id<>?").run(id);
    },
    async processQueued(limit = Number(process.env.BOOKFLIP_CATALOG_BATCH ?? 5)) {
      return worker.processBatch(limit);
    },
    status() {
      const counts = repository.counts();
      const cache = Number(repository.database.prepare('SELECT count(*) AS count FROM metadata_lookup_cache').get().count);
      const pending = Number(repository.database.prepare("SELECT count(*) AS count FROM identification_jobs WHERE status<>'completed'").get().count);
      return { enabled: true, counts: { ...counts, identification_pending: pending, metadata_lookup_cache: cache } };
    },
    close() { repository.close(); },
  };
}
