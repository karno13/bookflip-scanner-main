import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionCatalog} from './catalog-production.mjs';
import {storageMode,createSqliteBook,linkSqliteOffer,persistSqliteScan} from './sqlite-single-store.mjs';
import {sqliteHistoryModel} from './sqlite-history-read.mjs';

const first='2026-10-31T12:00:00.000Z',second='2026-10-31T13:00:00.000Z';
const offer={source:'Vinted',url:'https://www.vinted.pl/items/123-test',title:'Diuna Frank Herbert',price:2500};
test('SQLite is the only default active storage mode',()=>{
 assert.equal(storageMode({}),'sqlite');
 assert.equal(storageMode({BOOKFLIP_STORAGE:'json'}),'json');
 assert.throws(()=>storageMode({BOOKFLIP_STORAGE:'unknown'}),/INVALID_STORAGE_MODE/);
});
test('fresh SQLite scan, repeated scan and price change are durable without JSON',()=>{
 const c=createProductionCatalog({databasePath:':memory:'});
 try{
  const a=persistSqliteScan(c,{offers:[offer],searchedAt:first});
  assert.equal(a.summary.newOffers,1);
  assert.equal(a.summary.priceChanges,0);
  assert.equal(a.history.saved,1);
  assert.equal(a.offers[0].currentPrice,2500);
  const b=persistSqliteScan(c,{offers:[offer],searchedAt:second});
  assert.equal(b.summary.newOffers,0);
  assert.equal(b.summary.priceChanges,0);
  const d=persistSqliteScan(c,{offers:[{...offer,price:1900}],searchedAt:'2026-10-31T14:00:00.000Z'});
  assert.equal(d.summary.priceChanges,1);
  const model=sqliteHistoryModel(c.repository);
  assert.equal(Object.values(model.offers)[0].seenCount,3);
  assert.equal(model.priceHistory.length,2);
  assert.equal(model.lastScan.priceChanges,1);
 }finally{c.close();}
});
test('SQLite-only manual catalog and offer assignment survive repeated assignment',()=>{
 const c=createProductionCatalog({databasePath:':memory:'});
 try{
  persistSqliteScan(c,{offers:[offer],searchedAt:first});
  const a=createSqliteBook(c,{title:'Diuna'});
  assert.equal(a.created,true);
  const offerId=Object.keys(sqliteHistoryModel(c.repository).offers)[0];
  linkSqliteOffer(c,{offerId,bookId:a.book.id});
  linkSqliteOffer(c,{offerId,bookId:a.book.id});
  const model=sqliteHistoryModel(c.repository);
  assert.equal(model.offers[offerId].bookId,a.book.id);
  assert.equal(model.offers[offerId].linkMode,'manual');
  assert.equal(c.repository.database.prepare("SELECT COUNT(*) AS n FROM offer_matches WHERE status='active' AND offer_id=?").get(offerId).n,1);
  assert.equal(Object.values(model.offers)[0].currentPrice,2500);
  assert.throws(()=>linkSqliteOffer(c,{offerId:'missing',bookId:a.book.id}),/OFFER_NOT_FOUND/);
 }finally{c.close();}
});
test('invalid manual book does not leave partial SQLite records',()=>{
 const c=createProductionCatalog({databasePath:':memory:'});
 try{
  assert.throws(()=>createSqliteBook(c,{title:'  '}),/INVALID_BOOK_TITLE/);
  assert.throws(()=>createSqliteBook(c,{title:'Example',isbn:'bad'}),/INVALID_BOOK_ISBN/);
  assert.equal(c.repository.counts().works,0);
 }finally{c.close();}
});
