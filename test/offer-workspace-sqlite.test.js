import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteCatalogRepository} from '../sqlite-catalog-repository.mjs';
import {listOfferWorkspace,setOfferWorkspace,importOfferWorkspace} from '../offer-workspace-api.mjs';
test('offer workspace is persistent, validates updates and compares price to PLN threshold',() => {
 const repo=new SqliteCatalogRepository(':memory:');
 const now=new Date().toISOString();
 repo.database.prepare(`INSERT INTO offers(id,source,normalized_url,original_title,current_price,currency,created_at,updated_at)
 VALUES (?,?,?,?,?,?,?,?)`).run('offer-1','test','https://example.com/1','Test',2500,'PLN',now,now);
 const row=setOfferWorkspace(repo,'offer-1',{watched:true,status:'check',targetPrice:30,note:'ok'});
 assert.equal(row.watched,true);
 assert.equal(row.targetPrice,30);
 assert.equal(listOfferWorkspace(repo)[0].currentPrice,2500);
 assert.equal(listOfferWorkspace(repo)[0].targetReached,true);
 repo.database.prepare('UPDATE offers SET current_price=? WHERE id=?').run(3500,'offer-1');
 assert.equal(listOfferWorkspace(repo)[0].targetReached,false);
 setOfferWorkspace(repo,'offer-1',{watched:true,status:'check',targetPrice:35,note:'ok'});
 assert.equal(listOfferWorkspace(repo)[0].targetReached,true);
 setOfferWorkspace(repo,'offer-1',{watched:true,status:'check',targetPrice:34.99,note:'ok'});
 assert.equal(listOfferWorkspace(repo)[0].targetReached,false);
 assert.throws(()=>setOfferWorkspace(repo,'offer-1',{watched:true,status:'bad',targetPrice:1,note:''}),/INVALID_OFFER_WORKSPACE/);
 assert.throws(()=>setOfferWorkspace(repo,'missing',{watched:true,status:'watching',targetPrice:null,note:''}),/OFFER_NOT_FOUND/);
 repo.close?.();
});

test('legacy import does not overwrite existing notes and skips missing offers', () => {
 const repo = new SqliteCatalogRepository(':memory:');
 try {
  const at = new Date().toISOString();
  const insert = repo.database.prepare('INSERT INTO offers(id,source,normalized_url,original_title,current_price,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)');
  insert.run('a','test','https://example.com/a','A',2500,'PLN',at,at);
  insert.run('b','test','https://example.com/b','B',2500,'PLN',at,at);
  setOfferWorkspace(repo,'a',{watched:true,status:'bought',targetPrice:20,note:'Nowa notatka'});
  const entries=[
   {offerId:'a',record:{watched:false,status:'watching',targetPrice:30,note:'stara notatka'}},
   {offerId:'b',record:{watched:true,status:'check',targetPrice:30,note:'import'}},
   {offerId:'missing',record:{watched:true,status:'watching',targetPrice:null,note:''}},
   {offerId:'invalid',record:{watched:true,status:'wrong',targetPrice:20,note:''}},
  ];
  assert.deepEqual(importOfferWorkspace(repo,entries),{imported:1,skipped:1,missing:1,invalid:1});
  assert.equal(listOfferWorkspace(repo).find(x=>x.offerId==='a').note,'Nowa notatka');
  assert.equal(listOfferWorkspace(repo).find(x=>x.offerId==='a').status,'bought');
  assert.equal(listOfferWorkspace(repo).find(x=>x.offerId==='b').targetReached,true);
  assert.deepEqual(importOfferWorkspace(repo,entries),{imported:0,skipped:2,missing:1,invalid:1});
  assert.throws(()=>importOfferWorkspace(repo,Array(201).fill(entries[0])),/INVALID_IMPORT_BATCH/);
 } finally {repo.close();}
});
