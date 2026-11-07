import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enrichOffers, pendingEnrichment } from './offer-enrichment.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

const page = readFileSync(new URL('./fixtures/details/tezeusz-product.html', import.meta.url), 'utf8');

function setup() {
  const repo = new SqliteCatalogRepository(':memory:');
  const make = (n, source = 'Tezeusz.pl', isbn = null) => {
    const offer = repo.upsertOffer({
      source,
      normalizedUrl: `https://tezeusz.pl/p${n}`,
      originalTitle: 'T' + n,
      currentPrice: 1000,
      observedIsbn: isbn,
    });
    repo.putIdentificationJob({ offerId: offer.id, status: 'review_required' });
    return offer;
  };
  return { repo, make };
}
const status = (repo, id) =>
  repo.database.prepare('SELECT status FROM identification_jobs WHERE offer_id=?').get(id).status;

test('an ISBN found on the detail page is stored as structured evidence and re-queues the job', async () => {
  const { repo, make } = setup();
  const offer = make(1);
  const report = await enrichOffers(repo, { fetchHtml: async () => page });
  assert.equal(report.isbnFound, 1);
  assert.equal(report.requeued, 1);
  assert.equal(
    repo.database.prepare('SELECT observed_isbn FROM offers WHERE id=?').get(offer.id).observed_isbn,
    '9788388916014',
  );
  const evidence = repo.database
    .prepare("SELECT classification,source_type FROM metadata_evidence WHERE offer_id=? AND field_name='isbn'")
    .get(offer.id);
  assert.deepEqual({ ...evidence }, { classification: 'structured', source_type: 'detail:Tezeusz.pl' });
  assert.equal(status(repo, offer.id), 'queued');
  const row = repo.database
    .prepare('SELECT outcome,facts_json FROM offer_enrichment WHERE offer_id=?')
    .get(offer.id);
  assert.equal(row.outcome, 'isbn_found');
  assert.equal(JSON.parse(row.facts_json).publisher, 'ISA');
});

test('a page without an ISBN is recorded once and not fetched again', async () => {
  const { repo, make } = setup();
  make(1);
  let calls = 0;
  const fetchHtml = async () => {
    calls++;
    return '<html></html>';
  };
  assert.equal((await enrichOffers(repo, { fetchHtml })).noIsbn, 1);
  assert.equal((await enrichOffers(repo, { fetchHtml })).checked, 0);
  assert.equal(calls, 1);
});

test('offers that already have an ISBN or come from other sources are skipped', () => {
  const { repo, make } = setup();
  make(1, 'Tezeusz.pl', '9788388916014');
  make(2, 'Vinted');
  assert.deepEqual(pendingEnrichment(repo), []);
});

test('a block stops the run, and failed offers wait before a bounded number of retries', async () => {
  const { repo, make } = setup();
  make(1);
  make(2);
  let now = new Date('2026-11-07T10:00:00Z');
  const clock = () => now;
  const blocked = Object.assign(new Error('SOURCE_CAPTCHA'), { blocked: true });
  const report = await enrichOffers(repo, {
    fetchHtml: async () => {
      throw blocked;
    },
    now: clock,
  });
  assert.equal(report.stopped, 'SOURCE_CAPTCHA');
  assert.equal(report.checked, 1, 'the second offer must not be requested after a block');
  const first = repo.database.prepare('SELECT offer_id FROM offer_enrichment').get().offer_id;
  assert.equal(
    pendingEnrichment(repo, { now: clock }).filter((o) => o.id === first).length,
    0,
    'a freshly failed offer waits before the next try',
  );
  for (let attempt = 0; attempt < 4; attempt++) {
    now = new Date(now.getTime() + 2 * 3600_000);
    await enrichOffers(repo, {
      fetchHtml: async () => {
        throw new Error('SOURCE_HTTP_500');
      },
      now: clock,
    });
  }
  now = new Date(now.getTime() + 2 * 3600_000);
  assert.equal(pendingEnrichment(repo, { now: clock }).length, 0, 'gives up after three attempts');
  assert.equal(
    repo.database.prepare('SELECT attempts FROM offer_enrichment WHERE offer_id=?').get(first).attempts,
    3,
  );
});

test('a bundle is not re-queued by new evidence', async () => {
  const { repo, make } = setup();
  const offer = make(1);
  repo.database
    .prepare('INSERT INTO offer_sets(offer_id,created_at,updated_at) VALUES(?,?,?)')
    .run(offer.id, 'x', 'x');
  const report = await enrichOffers(repo, { fetchHtml: async () => page });
  assert.equal(report.isbnFound, 1);
  assert.equal(report.requeued, 0);
  assert.equal(status(repo, offer.id), 'review_required');
});
