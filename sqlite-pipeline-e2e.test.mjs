import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProductionCatalog} from './catalog-production.mjs';
import {createLocalAppServer,searchOffers} from './local-app.mjs';
import {createSqliteBook} from './sqlite-single-store.mjs';

const ISBN='9780306406157';
const listings=[
 {title:'Theoretical Physics',url:'https://www.empik.com/theoretical-physics,p1,ksiazka-p?utm_source=fixture',price:2599,isbn:ISBN},
 {title:'Another edition without ISBN',url:'https://www.empik.com/other-book,p2,ksiazka-p',price:1199},
];
const scans=['2026-10-30T12:00:00.000Z','2026-10-31T12:00:00.000Z'];
function fakeDiscovery(){
 let scan=0;
 return (input,options)=>searchOffers(input,{
  ...options,
  now:()=>new Date(scans[Math.min(scan,1)]),
  scanner:async task=>{
   assert.equal(task.source,'Empik');
   const at=scan++;
   return{offers:listings.map((x,i)=>i===0&&at>0?{...x,price:1999}:x),pagination:{state:'end'}};
  },
  retryWait:async()=>{}
 });
}
async function openHttp(catalog,search){
 const server=createLocalAppServer({catalogProvider:()=>catalog,search});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const origin='http://127.0.0.1:'+server.address().port;
 return{
  origin,
  request:async(path,body)=>{
   const response=await fetch(origin+path,body===undefined?{}:{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
   return{status:response.status,data:await response.json()};
  },
  close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
 };
}

test('end-to-end offline: discovery -> SQLite -> ISBN identification -> HTTP history -> price change -> restart',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'bookflip-e2e-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const dbPath=join(directory,'catalog.sqlite'),jsonPath=join(directory,'local-offer-history.json');
 let catalog=createProductionCatalog({databasePath:dbPath,fetcher:async()=>{throw Error('UNEXPECTED_EXTERNAL_REQUEST')}});
 let server;
 try{
  const created=createSqliteBook(catalog,{title:'Theoretical Physics',isbn:ISBN});
  assert.ok(created.book.id);
  server=await openHttp(catalog,fakeDiscovery());
  let res=await server.request('/api/search',{queries:['Theoretical Physics'],sources:['Empik']});
  assert.equal(res.status,200);
  assert.equal(res.data.offers.length,2);
  assert.equal(res.data.history.new,2);
  assert.equal(res.data.catalog.ingest.offers,2);
  assert.equal(existsSync(jsonPath),false,'SQLite default must not create JSON mirror');

  const queued=catalog.repository.database.prepare('SELECT status FROM identification_jobs ORDER BY id').all();
  assert.equal(queued.length,2);
  assert.ok(queued.every(j=>j.status==='queued'));
  const batch=await catalog.processQueued(5);
  assert.equal(batch.failed,0);
  assert.equal(batch.processed,2);

  const catalogOffers=await server.request('/api/offers?limit=10');
  assert.equal(catalogOffers.status,200);
  assert.equal(catalogOffers.data.total,2);
  const priced=catalogOffers.data.items.find(x=>x.currentPrice===2599);
  const unknown=catalogOffers.data.items.find(x=>x.currentPrice===1199);
  assert.ok(priced.match?.editionId,'ISBN should be linked to existing verified edition');
  assert.equal(unknown.identification.status,'review_required');
  const book=await server.request('/api/book?id='+encodeURIComponent(created.book.id));
  assert.equal(book.status,200);
  assert.equal(book.data.offers.length,1);
  assert.equal(book.data.offers[0].currentPrice,2599);
  const history=await server.request('/api/history');
  assert.equal(history.status,200);
  assert.equal(history.data.lastScan.found,2);
  assert.equal(history.data.offers.length,2);

  const manual=await server.request('/api/catalog',{title:'Other manually verified edition'});
  assert.equal(manual.status,201);
  const linked=await server.request('/api/catalog/link',{offerId:unknown.id,bookId:manual.data.book.id});
  assert.equal(linked.status,200);
  assert.equal(linked.data.offers.find(x=>x.id===unknown.id).bookId,manual.data.book.id);

  res=await server.request('/api/search',{queries:['Theoretical Physics'],sources:['Empik']});
  assert.equal(res.status,200);
  assert.equal(res.data.summary.priceChanges,1);
  const detail=await server.request('/api/offers/'+encodeURIComponent(priced.id));
  assert.equal(detail.status,200);
  const points=catalog.repository.database.prepare('SELECT price FROM offer_price_history WHERE offer_id=? ORDER BY observed_at').all(priced.id);
  assert.deepEqual(points.map(x=>x.price),[2599,1999]);
  const seen=catalog.repository.database.prepare('SELECT seen_count FROM offers WHERE id=?').get(priced.id);
  assert.equal(seen.seen_count,2);
  assert.equal(existsSync(jsonPath),false);

  await server.close();server=null;
  catalog.close();catalog=null;
  catalog=createProductionCatalog({databasePath:dbPath,fetcher:async()=>{throw Error('UNEXPECTED_EXTERNAL_REQUEST')}});
  server=await openHttp(catalog,()=>{throw Error('DISCOVERY_NOT_EXPECTED')});
  const afterRestart=await server.request('/api/history');
  assert.equal(afterRestart.status,200);
  assert.equal(afterRestart.data.offers.find(x=>x.id===priced.id).currentPrice,1999);
  assert.equal(afterRestart.data.lastScan.priceChanges,1);
  assert.equal(afterRestart.data.offers.find(x=>x.id===unknown.id).bookId,manual.data.book.id);
  const bookAfter=await server.request('/api/book?id='+encodeURIComponent(created.book.id));
  assert.equal(bookAfter.status,200);
  assert.equal(bookAfter.data.priceHistory.length,2);
 }finally{
  if(server)await server.close();
  if(catalog)catalog.close();
 }
});
