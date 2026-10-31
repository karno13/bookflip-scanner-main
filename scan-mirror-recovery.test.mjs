import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionCatalog} from './catalog-production.mjs';
import {emptyOfferHistory} from './offer-history.mjs';
import {persistScannedOffers} from './scan-persistence.mjs';
import {recoverPendingMirrors} from './scan-mirror-recovery.mjs';

const at='2026-10-31T18:00:00.000Z';
const offers=[{source:'Vinted',url:'https://www.vinted.pl/items/789-book',title:'Diuna',price:2500}];
const catalog=()=>createProductionCatalog({databasePath:':memory:'});

test('SQLite transaction stores mirror outbox and successful JSON acknowledges it',async()=>{
 const c=catalog();
 let saved=null;
 try{
  await persistScannedOffers({history:emptyOfferHistory(),offers,searchedAt:at,catalogStore:c,sqliteFirst:true,saveHistory:async x=>{saved=x}});
  assert.equal(Object.keys(saved.offers).length,1);
  const row=c.repository.database.prepare('SELECT status,snapshot_json FROM scan_json_mirror_outbox').get();
  assert.equal(row.status,'completed');
  assert.equal(JSON.parse(row.snapshot_json).lastScan.at,at);
 }finally{c.close();}
});
test('interrupted mirror stays recoverable, with no repeated SQLite ingest',async()=>{
 const c=catalog();let mirror=null;
 try{
  await assert.rejects(persistScannedOffers({history:emptyOfferHistory(),offers,searchedAt:at,catalogStore:c,sqliteFirst:true,saveHistory:async()=>{throw Error('DISK_FULL')}}),/DISK_FULL/);
  const countBefore=c.repository.database.prepare('SELECT seen_count FROM offers LIMIT 1').get().seen_count;
  assert.equal(c.repository.database.prepare("SELECT COUNT(*) AS n FROM scan_json_mirror_outbox WHERE status='pending'").get().n,1);
  const report=await recoverPendingMirrors({repository:c.repository,loadHistory:async()=>emptyOfferHistory(),saveHistory:async h=>{mirror=h}});
  assert.equal(report.recovered,1);
  assert.equal(Object.keys(mirror.offers).length,1);
  assert.equal(c.repository.database.prepare('SELECT seen_count FROM offers LIMIT 1').get().seen_count,countBefore);
  assert.equal(c.repository.database.prepare("SELECT COUNT(*) AS n FROM scan_json_mirror_outbox WHERE status='pending'").get().n,0);
 }finally{c.close();}
});
test('recovery refuses to overwrite newer JSON manual changes',async()=>{
 const c=catalog();let writes=0;
 try{
  await assert.rejects(persistScannedOffers({history:emptyOfferHistory(),offers,searchedAt:at,catalogStore:c,sqliteFirst:true,saveHistory:async()=>{throw Error('DISK_FULL')}}),/DISK_FULL/);
  await assert.rejects(recoverPendingMirrors({repository:c.repository,loadHistory:async()=>({...emptyOfferHistory(),updatedAt:'2026-11-01T18:00:00.000Z'}),saveHistory:async()=>{writes++}}),/JSON_MIRROR_RECOVERY_CONFLICT/);
  assert.equal(writes,0);
  assert.equal(c.repository.database.prepare("SELECT COUNT(*) AS n FROM scan_json_mirror_outbox WHERE status='conflict'").get().n,1);
 }finally{c.close();}
});
