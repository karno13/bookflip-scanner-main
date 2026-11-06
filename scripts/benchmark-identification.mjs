import {createProductionCatalog} from '../catalog-production.mjs';
import {createIdentificationScheduler} from '../identification-scheduler.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// Synthetic local queue only: no user database, no remote metadata calls.
export async function benchmarkIdentification({offerCount=1000}={}) {
  if(!Number.isSafeInteger(offerCount)||offerCount<1||offerCount>10000)throw Error('INVALID_BENCHMARK_OFFER_COUNT');
  let networkRequests=0,batches=0;
  const catalog=createProductionCatalog({databasePath:':memory:',fetcher:async()=>{networkRequests++;throw Error('NETWORK_NOT_ALLOWED');}});
  const scheduler=createIdentificationScheduler({runBatch:()=>{batches++;return catalog.processQueued(25);}});
  try {
    catalog.ingestOffers(Array.from({length:offerCount},(_,i)=>({source:'fixture',url:'https://example.test/benchmark/'+i,title:'Synthetic book '+i,price:2500})));
    const started=performance.now();
    await scheduler.tick();
    const elapsedMs=Math.round((performance.now()-started)*100)/100;
    const reviewRequired=catalog.status().identification.statuses.review_required||0;
    if(reviewRequired!==offerCount || networkRequests!==0)throw Error('BENCHMARK_INCORRECT_IDENTIFICATION');
    return {scenario:'synthetic-offline-missing-isbn',offerCount,elapsedMs,batches,networkRequests,reviewRequired,
      note:'Queue throughput only. Missing ISBN correctly requires review; this is not a benchmark of external providers.'};
  }finally{await scheduler.stop();catalog.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const index=process.argv.indexOf('--offers');
  benchmarkIdentification({offerCount:index<0?1000:Number(process.argv[index+1])})
    .then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
