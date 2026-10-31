import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {compareHistoryStores} from './history-parity.mjs';

function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE offers (id TEXT, source TEXT, normalized_url TEXT, current_price INTEGER, seen_count INTEGER)');
 return db;
}
function history(offers){return {version:2,offers:Object.fromEntries(offers.map(item=>[item.id,item]))};}
const offer={id:'Vinted:123',source:'Vinted',url:'https://www.vinted.pl/items/123-book?utm_source=x',currentPrice:2200,seenCount:3};

test('parity gate accepts identical normalized URL without changing SQLite',()=>{
 const db=fixture();
 try{
  db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run('Vinted:123','Vinted','https://www.vinted.pl/items/123-book',2200,3);
  const before=db.prepare('SELECT * FROM offers').all();
  const result=compareHistoryStores(history([offer]),db);
  assert.equal(result.safeToCutOver,true);
  assert.equal(result.summary.matched,1);
  assert.deepEqual(db.prepare('SELECT * FROM offers').all(),before);
 }finally{db.close();}
});
test('parity flags missing offers and prices, without claiming SQLite-only rows are lost',()=>{
 const db=fixture();
 try{
  db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run('Vinted:123','Vinted','https://www.vinted.pl/items/123-book',2600,4);
  db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run('extra','OLX','https://www.olx.pl/d/oferta/extra',1000,1);
  const other={...offer,id:'OLX:5',source:'OLX',url:'https://www.olx.pl/d/oferta/missing'};
  const report=compareHistoryStores(history([offer,other]),db);
  assert.equal(report.safeToCutOver,false);
  assert.equal(report.summary.priceDifferences,1);
  assert.equal(report.summary.missingInSqlite,1);
  assert.equal(report.summary.sqliteOnly,1);
  assert.equal(report.summary.seenCountDifferences,1);
 }finally{db.close();}
});
test('parity does not guess when SQLite contains ambiguous source URLs',()=>{
 const db=fixture();
 try{
  db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run('a','Vinted','https://www.vinted.pl/items/123-book',2200,3);
  db.prepare('INSERT INTO offers VALUES (?,?,?,?,?)').run('b','Vinted','https://www.vinted.pl/items/123-book',2200,3);
  const report=compareHistoryStores(history([offer]),db);
  assert.equal(report.safeToCutOver,false);
  assert.equal(report.summary.ambiguousMatches,1);
  assert.equal(report.samples.ambiguousMatches.length,1);
 }finally{db.close();}
});
test('invalid JSON URLs fail the migration gate and errors are bounded',()=>{
 const db=fixture();
 try{
  const report=compareHistoryStores(history([{...offer,url:'not a url'}]),db,{sampleLimit:0});
  assert.equal(report.safeToCutOver,false);
  assert.equal(report.summary.invalidJsonUrls,1);
  assert.deepEqual(report.samples.invalidJsonUrls,[]);
  assert.throws(()=>compareHistoryStores(history([]),db,{sampleLimit:101}),/INVALID_SAMPLE_LIMIT/);
 }finally{db.close();}
});
