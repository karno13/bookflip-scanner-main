import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProductionCatalog} from './catalog-production.mjs';

test('identification batch continues after transient resolver failure',async()=>{
  const catalog=createProductionCatalog({databasePath:':memory:'});
  try{
    catalog.ingestOffers([
      {source:'fixture',url:'https://example.test/items/101',title:'First printing',price:120},
      {source:'fixture',url:'https://example.test/items/102',title:'Second printing',price:130}
    ],new Date('2026-01-01T10:00:00Z'));
    const jobs=catalog.repository.database.prepare('SELECT offer_id FROM identification_jobs ORDER BY created_at,id').all();
    assert.equal(jobs.length,2);
    const first=jobs[0].offer_id;
    catalog.resolver.resolve=async({offerId})=>offerId===first
      ? Promise.reject(Object.assign(Error('TEMPORARY_METADATA_FAILURE'),{status:503,retryable:true}))
      : {decision:'review_required',reason:['no_isbn_evidence']};
    const result=await catalog.processQueued(2);
    assert.equal(result.processed,1);
    assert.equal(result.failed,1);
    const rows=catalog.repository.database.prepare('SELECT offer_id,status,run_after FROM identification_jobs').all();
    assert.equal(rows.find(row=>row.offer_id===first).status,'retry_wait');
    assert.ok(rows.find(row=>row.offer_id===first).run_after);
    assert.equal(rows.find(row=>row.offer_id!==first).status,'review_required');
  }finally{catalog.close();}
});

test('the scanner no longer awaits remote ISBN resolution before responding',()=>{
  const app=readFileSync(new URL('./local-app.mjs',import.meta.url),'utf8');
  assert.match(app,/scheduleCatalogResolution\(catalogStore\)/);
  assert.doesNotMatch(app,/await catalogStore\.processQueued\(\)/);
  assert.match(app,/runningCatalogResolution/);
});
