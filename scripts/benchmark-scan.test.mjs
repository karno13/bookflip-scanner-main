import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkScan } from './benchmark-scan.mjs';

test('synthetic benchmark verifies new/changed prices without network access',async()=>{
  const result=await benchmarkScan({offerCount:20});
  assert.equal(result.scenario,'synthetic-offline');
  assert.equal(result.initial.newOffers,20);
  assert.equal(result.repeat.priceChanges,2);
  assert.equal(result.repeat.totalStoredOffers,20);
  assert.equal(result.priceObservations,22);
  assert.ok(Number.isFinite(result.initial.elapsedMs));
  assert.ok(result.databaseBytes>0);
});
test('benchmark bounds the number of generated records',async()=>{
  await assert.rejects(benchmarkScan({offerCount:0}),/INVALID_BENCHMARK_OFFER_COUNT/);
  await assert.rejects(benchmarkScan({offerCount:100001}),/INVALID_BENCHMARK_OFFER_COUNT/);
});
