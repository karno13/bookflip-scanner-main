import assert from 'node:assert/strict';
import test from 'node:test';
import { scanQueryStats } from './trading-api.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('query stats count offers, catalogue matches and waiting jobs per phrase and source', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  const offer = (n, queries, isbn = null) =>
    repo.upsertOffer({
      source: 'Vinted',
      normalizedUrl: `https://www.vinted.pl/items/${n}`,
      originalTitle: 'T' + n,
      currentPrice: 1000,
      observedIsbn: isbn,
      matchedQueries: queries,
    });
  const a = offer(1, ['Warcraft'], '9788388916014');
  const b = offer(2, ['Warcraft']);
  offer(3, ['Warcraft', 'Warhammer']);
  repo.putIdentificationJob({ offerId: b.id, status: 'review_required' });
  repo.createWork({ id: 'w', title: 'W', authors: ['A'], at: '2026-01-01T00:00:00Z' });
  repo.createEdition({ id: 'e', workId: 'w', title: 'W', at: '2026-01-01T00:00:00Z' });
  repo.assignOfferToEdition(a.id, 'e', { id: 'm', method: 'structured_isbn', status: 'active', createdBy: 't', at: '2026-01-01T00:00:00Z' });
  const rows = Object.fromEntries(scanQueryStats(repo).items.map((r) => [r.query, r]));
  assert.deepEqual(
    { offers: rows.Warcraft.offers, matched: rows.Warcraft.matched, waiting: rows.Warcraft.waiting, withoutIsbn: rows.Warcraft.withoutIsbn },
    { offers: 3, matched: 1, waiting: 1, withoutIsbn: 2 },
  );
  assert.equal(rows.Warhammer.offers, 1);
});
