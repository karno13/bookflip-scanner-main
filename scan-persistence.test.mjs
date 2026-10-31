import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyOfferHistory} from './offer-history.mjs';
import {persistScannedOffers} from './scan-persistence.mjs';

const searchedAt='2026-10-31T17:00:00.000Z';
const offers=[{source:'Vinted',url:'https://www.vinted.pl/items/123-book',title:'Diuna Frank Herbert',price:2500,availability:'unconfirmed'}];
const input=()=>({history:emptyOfferHistory(),offers,searchedAt});

test('SQLite-first commits catalog before legacy JSON mirror',async()=>{
 const order=[];
 const result=await persistScannedOffers({...input(),sqliteFirst:true,
  catalogStore:{ingestOffers(rows,at){order.push('sqlite');assert.equal(rows.length,1);assert.equal(at,searchedAt);return{offers:1}}},
  saveHistory:async(h)=>{order.push('json');assert.equal(Object.keys(h.offers).length,1)}
 });
 assert.deepEqual(order,['sqlite','json']);
 assert.equal(result.ingest.offers,1);
 assert.equal(result.applied.summary.new,1);
});
test('SQLite failure does not write the legacy JSON mirror',async()=>{
 let written=false;
 await assert.rejects(persistScannedOffers({...input(),sqliteFirst:true,
  catalogStore:{ingestOffers(){throw Error('SQLITE_WRITE_FAILED')}},
  saveHistory:async()=>{written=true}
 }),/SQLITE_WRITE_FAILED/);
 assert.equal(written,false);
});
test('JSON mirror failure is surfaced after SQLite commit (requires reconciliation)',async()=>{
 let sqliteCommits=0;
 await assert.rejects(persistScannedOffers({...input(),sqliteFirst:true,
  catalogStore:{ingestOffers(){sqliteCommits++;return{offers:1}}},
  saveHistory:async()=>{throw Error('JSON_MIRROR_FAILED')}
 }),/JSON_MIRROR_FAILED/);
 assert.equal(sqliteCommits,1);
});
test('SQLite-first refuses disabled SQLite instead of silently writing JSON',async()=>{
 let written=false;
 await assert.rejects(persistScannedOffers({...input(),sqliteFirst:true,
  saveHistory:async()=>{written=true}
 }),/SQLITE_FIRST_REQUIRES_CATALOG/);
 assert.equal(written,false);
});
test('legacy compatibility mode retains JSON-first ordering',async()=>{
 const order=[];
 await persistScannedOffers({...input(),catalogStore:{ingestOffers(){order.push('sqlite');return{offers:1}}},
  saveHistory:async()=>{order.push('json')}
 });
 assert.deepEqual(order,['json','sqlite']);
});
