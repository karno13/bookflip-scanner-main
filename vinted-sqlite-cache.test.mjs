import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { createSqliteVintedDetailCache } from './vinted-detail-sqlite-cache.mjs';

test('Vinted language evidence survives repository reopen and expires', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  let time = 1000;
  const options = {now: () => time, ttlMs: 1000, maxEntries: 2};
  const one = createSqliteVintedDetailCache(repo, options);
  one.set('https://www.vinted.pl/items/1',{language:'Polski',isbn:'9780000000002'});
  one.set('https://www.vinted.pl/items/2',{language:'angielski'});
  one.set('https://www.vinted.pl/items/unknown',{language:null});
  const second = createSqliteVintedDetailCache(repo, options);
  assert.deepEqual(second.get('https://www.vinted.pl/items/1'),{language:'Polski',isbn:'9780000000002'});
  assert.equal(second.size(),2);
  time=2000;
  assert.equal(second.get('https://www.vinted.pl/items/1'),undefined);
  repo.close();
});

test('Vinted SQLite cache never retains unknown or overly long language data', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  const cache = createSqliteVintedDetailCache(repo);
  cache.set('a',{language:''});
  cache.set('b',{language:'x'.repeat(101)});
  assert.equal(cache.size(),0);
  repo.close();
});
