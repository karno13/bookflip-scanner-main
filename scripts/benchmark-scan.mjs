// Synthetic, repeatable SQLite-only benchmark: NEVER calls marketplace APIs.
// Examples:
//   npm run bench:scan -- --offers 1000
//   npm run bench:scan -- --offers 10000
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProductionCatalog } from '../catalog-production.mjs';
import { persistSqliteScan } from '../sqlite-single-store.mjs';

export async function benchmarkScan({ offerCount = 1000 } = {}) {
  if (!Number.isSafeInteger(offerCount) || offerCount < 1 || offerCount > 100000)
    throw Error('INVALID_BENCHMARK_OFFER_COUNT');
  const dir = await mkdtemp(join(tmpdir(), 'bookflip-scan-benchmark-'));
  const dbPath = join(dir, 'synthetic.sqlite');
  let catalog;
  try {
    catalog = createProductionCatalog({ databasePath: dbPath });
    const offers = Array.from({ length: offerCount }, (_, index) => ({
      source: 'Vinted',
      url: `https://www.vinted.pl/items/${10000000 + index}-synthetic`,
      title: 'Warcraft synthetic sample ' + index,
      price: 2000 + (index % 120) * 100,
    }));
    const record = (name, batch, at) => {
      const started = performance.now();
      const result = persistSqliteScan(catalog, { offers: batch, searchedAt: at });
      return {
        name,
        elapsedMs: Number((performance.now() - started).toFixed(2)),
        newOffers: result.summary.newOffers,
        priceChanges: result.summary.priceChanges,
        totalStoredOffers: result.history.saved,
      };
    };
    const first = record('initial', offers, '2026-11-01T12:00:00.000Z');
    const changed = offers.map((offer, i) => i % 10 === 0
      ? { ...offer, price: offer.price - 100 } : offer);
    const repeat = record('repeat-with-10-percent-price-changes', changed,
      '2026-11-01T13:00:00.000Z');
    const expectedChanges = Math.ceil(offerCount / 10);
    if (first.newOffers !== offerCount || repeat.newOffers !== 0 ||
        repeat.priceChanges !== expectedChanges || repeat.totalStoredOffers !== offerCount)
      throw Error('BENCHMARK_INCORRECT_SCAN_COUNTS');
    const historyCount = catalog.repository.database
      .prepare('SELECT count(*) AS n FROM offer_price_history').get().n;
    if (historyCount !== offerCount + expectedChanges)
      throw Error('BENCHMARK_INCORRECT_PRICE_HISTORY');
    return {
      scenario: 'synthetic-offline',
      offerCount,
      node: process.version,
      platform: process.platform,
      initial: first,
      repeat,
      priceObservations: historyCount,
      databaseBytes: (await stat(dbPath)).size,
      rssBytes: process.memoryUsage().rss,
    };
  } finally {
    catalog?.close();
    await rm(dir, { recursive: true, force: true });
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const arg = process.argv.indexOf('--offers');
  const count = arg < 0 ? 1000 : Number(process.argv[arg + 1]);
  benchmarkScan({ offerCount: count })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
