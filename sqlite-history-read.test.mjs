import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionCatalog} from './catalog-production.mjs';
import {sqliteHistoryModel} from './sqlite-history-read.mjs';
import {analyzedOffers,bookHistory} from './price-analysis.mjs';

test('SQLite projection provides legacy history shape without modifying tables',()=>{
 const catalog=createProductionCatalog({databasePath:':memory:'});
 try{
  const offer={source:'Vinted',url:'https://www.vinted.pl/items/321-book',title:'Diuna',price:2500};
  catalog.ingestOffers([offer],new Date('2026-10-30T10:00:00Z'));
  catalog.ingestOffers([{...offer,price:2200}],new Date('2026-10-31T10:00:00Z'));
  const before=catalog.repository.counts();
  const model=sqliteHistoryModel(catalog.repository);
  assert.equal(model.version,2);
  assert.equal(Object.keys(model.offers).length,1);
  const row=Object.values(model.offers)[0];
  assert.equal(row.currentPrice,2200);
  assert.equal(row.seenCount,2);
  assert.equal(model.priceHistory.length,2);
  assert.equal(analyzedOffers(model).length,1);
  assert.deepEqual(catalog.repository.counts(),before);
 }finally{catalog.close();}
});
test('only active SQLite edition assignment sets legacy bookId',()=>{
 const catalog=createProductionCatalog({databasePath:':memory:'});
 try{
  catalog.ingestOffers([{source:'Vinted',url:'https://www.vinted.pl/items/322-book',title:'Unassigned book',price:2400}],new Date('2026-10-30T10:00:00Z'));
  const raw=sqliteHistoryModel(catalog.repository);
  const offer=Object.values(raw.offers)[0];
  assert.equal(offer.bookId,null);
  const now='2026-10-30T10:00:00Z',db=catalog.repository.database;
  catalog.repository.createWork({id:'work_demo',title:'Książka',verificationStatus:'manual',at:now});
  catalog.repository.createEdition({id:'edition_demo',workId:'work_demo',title:'Książka',verificationStatus:'manual',at:now});
  catalog.repository.assignOfferToEdition(offer.id,'edition_demo',{method:'manual',createdBy:'local_user',status:'active',at:now});
  const updated=sqliteHistoryModel(catalog.repository);
  const id=updated.offers[offer.id].bookId;
  assert.equal(id,'edition:edition_demo');
  assert.equal(updated.offers[offer.id].linkMode,'manual');
  assert.equal(bookHistory(updated,id).offers.length,1);
 }finally{catalog.close();}
});

test('scan summary is committed with offers and restored through SQLite history',()=>{
 const c=createProductionCatalog({databasePath:':memory:'});
 try{
  const at='2026-10-31T20:00:00.000Z';
  const summary={at,found:1,newOffers:1,priceChanges:0,errors:[]};
  c.ingestOffers([{source:'Vinted',url:'https://www.vinted.pl/items/876-book',title:'Book',price:1900}],at,{scanSummary:summary});
  assert.deepEqual(sqliteHistoryModel(c.repository).lastScan,summary);
  assert.equal(c.repository.database.prepare('SELECT count(*) AS n FROM scan_runs').get().n,1);
 }finally{c.close();}
});
test('invalid summary timestamp rolls back offer changes and scanner metadata',()=>{
 const c=createProductionCatalog({databasePath:':memory:'});
 try{
  assert.throws(()=>c.ingestOffers([{source:'Vinted',url:'https://www.vinted.pl/items/877-book',title:'Book',price:1900}],'2026-10-31T20:00:00.000Z',{scanSummary:{at:'2026-10-30T20:00:00.000Z'}}),/INVALID_SCAN_SUMMARY_TIME/);
  assert.equal(c.repository.database.prepare('SELECT count(*) AS n FROM offers').get().n,0);
  assert.equal(c.repository.database.prepare('SELECT count(*) AS n FROM scan_runs').get().n,0);
 }finally{c.close();}
});
