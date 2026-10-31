import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionCatalog} from './catalog-production.mjs';
import {emptyOfferHistory,applyScanToHistory} from './offer-history.mjs';
import {persistManualCatalogAction} from './sqlite-manual-catalog.mjs';
import {recoverPendingMirrors} from './scan-mirror-recovery.mjs';
import {sqliteHistoryModel} from './sqlite-history-read.mjs';

const at='2026-10-31T18:00:00.000Z';
const candidate={source:'Vinted',url:'https://www.vinted.pl/items/987-book',title:'Diuna',price:3500};
function fixture(){
 const catalog=createProductionCatalog({databasePath:':memory:'});
 catalog.ingestOffers([candidate],at);
 const history=applyScanToHistory(emptyOfferHistory(),[candidate],at).history;
 return{catalog,history,offerId:Object.keys(history.offers)[0]};
}
test('SQLite-first manual book create is visible in SQLite and mirrored into JSON',async()=>{
 const {catalog,history}=fixture();let mirrored=null;
 try{
  const result=await persistManualCatalogAction({catalogStore:catalog,history,action:'create',input:{title:'Diuna ręcznie'},saveHistory:async h=>{mirrored=h}});
  assert.equal(result.created,true);
  assert.ok(mirrored.books[result.book.id]);
  const edition=catalog.repository.database.prepare('SELECT legacy_id FROM editions WHERE legacy_id=?').get(result.book.id);
  assert.equal(edition.legacy_id,result.book.id);
  assert.ok(sqliteHistoryModel(catalog.repository).books[result.book.id]);
  assert.equal(catalog.repository.database.prepare("SELECT COUNT(*) AS n FROM scan_json_mirror_outbox WHERE status='pending'").get().n,0);
 }finally{catalog.close();}
});
test('SQLite-first manual assignment is active and idempotent',async()=>{
 const {catalog,history,offerId}=fixture();
 try{
  let stored=null;
  const created=await persistManualCatalogAction({catalogStore:catalog,history,action:'create',input:{title:'Diuna'},saveHistory:async h=>{stored=h}});
  const linked=await persistManualCatalogAction({catalogStore:catalog,history:stored,action:'link',input:{offerId,bookId:created.book.id},saveHistory:async h=>{stored=h}});
  assert.equal(linked.history.offers[offerId].bookId,created.book.id);
  const sqliteId=catalog.repository.database.prepare("SELECT id FROM offers LIMIT 1").get().id;
  const projection=sqliteHistoryModel(catalog.repository);
  assert.equal(projection.offers[sqliteId].bookId,created.book.id);
  assert.equal(projection.offers[sqliteId].linkMode,'manual');
  await persistManualCatalogAction({catalogStore:catalog,history:stored,action:'link',input:{offerId,bookId:created.book.id},saveHistory:async h=>{stored=h}});
  assert.equal(catalog.repository.database.prepare("SELECT COUNT(*) AS n FROM offer_matches WHERE offer_id=? AND status='active'").get(sqliteId).n,1);
 }finally{catalog.close();}
});
test('missing SQLite offer causes rollback without writing JSON',async()=>{
 const {catalog,history,offerId}=fixture();
 try{
  const created=await persistManualCatalogAction({catalogStore:catalog,history,action:'create',input:{title:'Diuna'},saveHistory:async()=>{}});
  catalog.repository.database.prepare('DELETE FROM offers').run();
  let wrote=false;
  await assert.rejects(persistManualCatalogAction({catalogStore:catalog,history:created.history,action:'link',input:{offerId,bookId:created.book.id},saveHistory:async()=>{wrote=true}}),/SQLITE_OFFER_NOT_FOUND/);
  assert.equal(wrote,false);
  assert.equal(catalog.repository.database.prepare("SELECT COUNT(*) AS n FROM scan_json_mirror_outbox WHERE status='pending'").get().n,0);
 }finally{catalog.close();}
});
test('failure after SQLite manual commit leaves recoverable JSON checkpoint',async()=>{
 const {catalog,history}=fixture();let mirrored=null;
 try{
  await assert.rejects(persistManualCatalogAction({catalogStore:catalog,history,action:'create',input:{title:'Diuna'},saveHistory:async()=>{throw Error('DISK_FULL')}}),/DISK_FULL/);
  assert.equal(catalog.repository.database.prepare("SELECT COUNT(*) AS n FROM scan_json_mirror_outbox WHERE status='pending'").get().n,1);
  const report=await recoverPendingMirrors({repository:catalog.repository,loadHistory:async()=>history,saveHistory:async h=>{mirrored=h}});
  assert.equal(report.recovered,1);
  assert.equal(Object.keys(mirrored.books).length,1);
  assert.equal(catalog.repository.database.prepare("SELECT COUNT(*) AS n FROM editions").get().n,1);
 }finally{catalog.close();}
});
