import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteCatalogRepository} from '../sqlite-catalog-repository.mjs';
import {listOfferWorkspace,setOfferWorkspace} from '../offer-workspace-api.mjs';
test('offer workspace is persistent, validates updates and compares price to PLN threshold',() => {
 const repo=new SqliteCatalogRepository(':memory:');
 const now=new Date().toISOString();
 repo.database.prepare(`INSERT INTO offers(id,source,normalized_url,original_title,current_price,currency,created_at,updated_at)
 VALUES (?,?,?,?,?,?,?,?)`).run('offer-1','test','https://example.com/1','Test',25,'PLN',now,now);
 const row=setOfferWorkspace(repo,'offer-1',{watched:true,status:'check',targetPrice:30,note:'ok'});
 assert.equal(row.watched,true);
 assert.equal(listOfferWorkspace(repo)[0].targetReached,true);
 repo.database.prepare('UPDATE offers SET current_price=? WHERE id=?').run(35,'offer-1');
 assert.equal(listOfferWorkspace(repo)[0].targetReached,false);
 assert.throws(()=>setOfferWorkspace(repo,'offer-1',{watched:true,status:'bad',targetPrice:1,note:''}),/INVALID_OFFER_WORKSPACE/);
 assert.throws(()=>setOfferWorkspace(repo,'missing',{watched:true,status:'watching',targetPrice:null,note:''}),/OFFER_NOT_FOUND/);
 repo.close?.();
});
