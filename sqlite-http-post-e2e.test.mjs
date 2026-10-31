import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProductionCatalog} from './catalog-production.mjs';
import {createLocalAppServer,searchOffers} from './local-app.mjs';

test('HTTP POST scan, ISBN resolution, manual assignment and restart use SQLite without JSON',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'bookflip-http-flow-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=join(dir,'catalog.sqlite'),legacy=join(dir,'local-offer-history.json');
 let catalog=createProductionCatalog({databasePath:db,fetcher:async()=>{throw Error('NETWORK_NOT_EXPECTED')}});
 let currentServer=null,scans=0;
 const scan=(input,options)=>{
  const run=scans++;
  return searchOffers(input,{...options,
   now:()=>new Date(run===0?'2026-10-30T12:00:00.000Z':'2026-10-31T12:00:00.000Z'),
   scanner:async()=>({offers:[
    {title:'Example scanned book',url:'https://www.empik.com/example,p1,ksiazka-p',price:run===0?2500:2000},
   ],pagination:{state:'end'}}),
   retryWait:async()=>{}
  });
 };
 async function start(search){
  const server=createLocalAppServer({catalogProvider:()=>catalog,search});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  currentServer=server;
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(path,input)=>{
   const response=await fetch(base+path,input===undefined?{}:{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(input)});
   return{status:response.status,data:await response.json()};
  };
  return request;
 }
 try{
  let request=await start(scan);
  const first=await request('/api/search',{queries:['Example scanned book'],sources:['Empik']});
  assert.equal(first.status,200);
  assert.equal(first.data.history.new,1);
  assert.equal(first.data.offers.length,1);
  const offerId=first.data.offers[0].id;
  assert.equal(existsSync(legacy),false);

  const batch=await catalog.processQueued(2);
  assert.equal(batch.failed,0);
  assert.ok(batch.processed===0||batch.processed===1,'background worker may finish first');
  const jobs=await request('/api/identification-jobs');
  assert.equal(jobs.status,200);
  assert.equal(catalog.repository.database.prepare('SELECT status FROM identification_jobs LIMIT 1').get().status,'review_required');

  const created=await request('/api/catalog',{title:'Manually verified example'});
  assert.equal(created.status,201);
  assert.ok(created.data.book.id);
  const linked=await request('/api/catalog/link',{offerId,bookId:created.data.book.id});
  assert.equal(linked.status,200);
  assert.equal(linked.data.offers.find(o=>o.id===offerId).bookId,created.data.book.id);
  const book=await request('/api/book?id='+encodeURIComponent(created.data.book.id));
  assert.equal(book.status,200);
  assert.equal(book.data.offers.length,1);

  const changed=await request('/api/search',{queries:['Example scanned book'],sources:['Empik']});
  assert.equal(changed.status,200);
  assert.equal(changed.data.summary.priceChanges,1);
  const prices=catalog.repository.database.prepare('SELECT price FROM offer_price_history WHERE offer_id=? ORDER BY observed_at').all(offerId);
  assert.deepEqual(prices.map(x=>x.price),[2500,2000]);
  assert.equal(existsSync(legacy),false);

  await new Promise(resolve=>currentServer.close(resolve));currentServer=null;
  catalog.close();catalog=null;
  catalog=createProductionCatalog({databasePath:db,fetcher:async()=>{throw Error('NETWORK_NOT_EXPECTED')}});
  request=await start(()=>{throw Error('MARKETPLACE_NOT_EXPECTED')});
  const snapshot=await request('/api/history');
  assert.equal(snapshot.status,200);
  assert.equal(snapshot.data.lastScan.priceChanges,1);
  assert.equal(snapshot.data.offers.find(o=>o.id===offerId).currentPrice,2000);
  assert.equal(snapshot.data.offers.find(o=>o.id===offerId).bookId,created.data.book.id);
 }finally{
  if(currentServer)await new Promise(resolve=>currentServer.close(resolve));
  if(catalog)catalog.close();
 }
});
