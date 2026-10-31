import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentificationScheduler} from './identification-scheduler.mjs';
import {createProductionCatalog} from './catalog-production.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('startup immediately processes queued identification without waiting for another scan',async()=>{
 let callback=null,runs=0,latest;
 const scheduler=createIdentificationScheduler({
  runBatch:async()=>{runs++;return{processed:1,failed:0}},
  onResult:result=>{latest=result},
  setIntervalFn:fn=>{callback=fn;return{unref(){}}},
  clearIntervalFn:()=>{}
 });
 scheduler.start();
 await flush();
 assert.equal(runs,1);
 assert.equal(latest.processed,1);
 callback();
 await flush();
 assert.equal(runs,2);
 await scheduler.stop();
 callback();
 await flush();
 assert.equal(runs,2);
});
test('multiple timer ticks and start calls never overlap network resolution',async()=>{
 let runCount=0,release;
 const pending=new Promise(resolve=>{release=resolve});
 let callback;
 const scheduler=createIdentificationScheduler({
  runBatch:async()=>{runCount++;await pending;return{processed:1}},
  setIntervalFn:fn=>{callback=fn;return{unref(){}}},
  clearIntervalFn:()=>{}
 });
 scheduler.start();
 scheduler.start();
 await flush();
 callback();callback();await flush();
 assert.equal(runCount,1);
 release();
 await scheduler.stop();
 assert.equal(runCount,1);
});
test('worker failures are reported and do not prevent future scheduled batches',async()=>{
 let ticks=0,errors=0;let callback;
 const scheduler=createIdentificationScheduler({
  runBatch:async()=>{ticks++;if(ticks===1)throw Error('NETWORK_TEMPORARY');return{processed:1}},
  onError:e=>{assert.equal(e.message,'NETWORK_TEMPORARY');errors++},
  setIntervalFn:fn=>{callback=fn;return{unref(){}}},
  clearIntervalFn:()=>{}
 });
 scheduler.start();await flush();assert.equal(errors,1);
 callback();await flush();assert.equal(ticks,2);
 await scheduler.stop();
});
test('periodic scheduler reclaims due retry_wait and expired leases from persisted SQLite',async()=>{
 let now=new Date('2026-10-31T12:00:00.000Z'),callback;
 const catalog=createProductionCatalog({databasePath:':memory:',now:()=>now});
 try{
  catalog.ingestOffers([{source:'fixture',url:'https://example.test/items/retry',title:'ISBN 9780000000002',price:200}],now);
  let attempts=0;
  catalog.resolver.resolve=async()=>{
   attempts++;
   if(attempts===1)throw Object.assign(Error('REMOTE_503'),{retryable:true,status:503});
   return{decision:'review_required',reason:['unconfirmed']};
  };
  const scheduler=createIdentificationScheduler({
   runBatch:()=>catalog.processQueued(1),
   setIntervalFn:fn=>{callback=fn;return{unref(){}}},
   clearIntervalFn:()=>{}
  });
  scheduler.start();
  await new Promise(resolve=>setImmediate(resolve));
  let job=catalog.repository.database.prepare('SELECT status,run_after,attempt_count FROM identification_jobs').get();
  assert.equal(job.status,'retry_wait');
  assert.equal(job.attempt_count,1);
  callback();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(attempts,1);
  now=new Date(Date.parse(job.run_after)+1000);
  await scheduler.tick();
  job=catalog.repository.database.prepare('SELECT status,attempt_count FROM identification_jobs').get();
  assert.equal(job.status,'review_required');
  assert.equal(job.attempt_count,2);
  await scheduler.stop();
 }finally{catalog.close();}
});
test('scheduler rejects nonbounded polling intervals',()=>{
 assert.throws(()=>createIdentificationScheduler({runBatch:()=>{},intervalMs:0}),/INVALID_SCHEDULER_INTERVAL/);
});
