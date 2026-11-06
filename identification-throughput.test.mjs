import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentificationScheduler} from './identification-scheduler.mjs';
import {createProductionCatalog} from './catalog-production.mjs';
import {lookupISBN} from './metadata-lookup.mjs';
import {createResourceRequester} from './metadata-http.mjs';
import {createOpenLibraryAdapter} from './metadata-sources/open-library.mjs';
import {identificationProgress} from './app/core/identification-progress.js';

test('ready batches drain without waiting for another polling interval',async()=>{
  let runs=0,yields=0;
  const scheduler=createIdentificationScheduler({runBatch:async()=>({processed:25,hasMore:++runs<4}),yieldFn:async()=>{yields++;}});
  await scheduler.tick();assert.equal(runs,4);assert.equal(yields,3);await scheduler.stop();
});

test('pause between ready batches stops draining immediately',async()=>{
  let runs=0;
  const scheduler=createIdentificationScheduler({runBatch:async()=>{runs++;return {processed:25,hasMore:true};},yieldFn:async()=>{scheduler.pause();}});
  await scheduler.tick();assert.equal(runs,1);assert.equal(scheduler.status().paused,true);await scheduler.stop();
});

test('a real queue larger than one batch drains fully without network calls for missing ISBN',async()=>{
  let network=0,batches=0;
  const catalog=createProductionCatalog({databasePath:':memory:',fetcher:async()=>{network++;throw Error('NETWORK_NOT_ALLOWED');}});
  const scheduler=createIdentificationScheduler({runBatch:()=>{batches++;return catalog.processQueued(25);}});
  try {
    catalog.ingestOffers(Array.from({length:103},(_,i)=>({source:'fixture',url:'https://example.test/'+i,title:'Test book '+i,price:2500})));
    await scheduler.tick();assert.equal(batches,5);assert.equal(network,0);
    assert.equal(catalog.status().identification.statuses.review_required,103);
    assert.equal(catalog.status().identification.runnable,0);
    assert.equal(catalog.status().identification.batch.hasMore,false);
  }finally{await scheduler.stop();catalog.close();}
});

test('equivalent concurrent ISBN lookups share requests and failed requests do not stick',async()=>{
  let calls=0,release;
  const hold=new Promise(resolve=>{release=resolve;});
  const adapter=source=>({source,lookup:async()=>{calls++;await hold;return {source,status:'not_found',records:[]};}});
  const bnAdapter=adapter('bn'),openLibraryAdapter=adapter('open_library');
  const first=lookupISBN('9780306406157',{bnAdapter,openLibraryAdapter});
  const second=lookupISBN('0306406152',{bnAdapter,openLibraryAdapter});
  await Promise.resolve();assert.equal(calls,1);release();
  const results=await Promise.all([first,second]);assert.equal(results[1].bn.cache.coalesced,true);
  let failures=0;const failing={source:'bn',lookup:async()=>{failures++;throw Error('TEMPORARY');}};
  await assert.rejects(lookupISBN('9780306406157',{bnAdapter:failing,openLibraryAdapter}),/TEMPORARY/);
  await assert.rejects(lookupISBN('9780306406157',{bnAdapter:failing,openLibraryAdapter}),/TEMPORARY/);
  assert.equal(failures,2);
});

test('resource cache expires, evicts old entries and never caches errors',async()=>{
  assert.throws(()=>createResourceRequester(async()=>({}),{maxEntries:-1}),RangeError);
  let now=0,calls=0;
  const request=createResourceRequester(async url=>{calls++;return {status:url.includes('error')?'temporary_error':'found',payload:{key:url}};},{now:()=>now,ttlMs:10,maxEntries:1});
  const a='https://openlibrary.org/authors/OLA.json',b='https://openlibrary.org/works/OLB.json',error='https://openlibrary.org/works/error.json';
  await request(a);await request(a);assert.equal(calls,1);
  await request(b);await request(a);assert.equal(calls,3);
  now=11;await request(a);assert.equal(calls,4);
  await request(error);await request(error);assert.equal(calls,6);
});

test('two different editions reuse shared Open Library work and author resources',async()=>{
  const calls=[];const isbns=['9780306406157','9783161484100'];
  const adapter=createOpenLibraryAdapter({requester:async url=>{
    calls.push(url);
    if(url.includes('/isbn/')) {const isbn=isbns.find(value=>url.includes(value));return {status:'found',payload:{key:'/books/'+isbn+'M',title:'Physics',isbn_13:[isbn],works:[{key:'/works/OL1W'}]}};}
    if(url.includes('/works/'))return {status:'found',payload:{key:'/works/OL1W',authors:[{author:{key:'/authors/OL1A'}}]}};
    return {status:'found',payload:{key:'/authors/OL1A',name:'Author'}};
  }});
  const results=await Promise.all(isbns.map(isbn=>adapter.lookup(isbn)));
  assert.ok(results.every(result=>result.status==='found'));
  assert.equal(calls.filter(url=>url.includes('/works/')).length,1);
  assert.equal(calls.filter(url=>url.includes('/authors/')).length,1);
  assert.equal(calls.length,4);
});

test('manual decisions and missing metadata do not look like unfinished automatic work',()=>{
  const progress=identificationProgress({completed:518,review_required:531});
  assert.equal(progress.percent,100);assert.equal(progress.pending,0);assert.equal(progress.review,531);assert.equal(progress.completed,518);
  assert.equal(identificationProgress({completed:1,review_required:1,queued:2}).percent,50);
  assert.equal(identificationProgress({failed:1}).failed,1);
});
