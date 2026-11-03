import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketplaceGate } from './marketplace-gate.mjs';
import { readSourceHtml } from './marketplaces.mjs';

test('concurrent requests for same source have serialized starts; other sources remain independent', async () => {
  let clock = 10000;
  const waits = [];
  const gate = createMarketplaceGate({intervalMs:2000});
  const options = {now:()=>clock,pause:async delay=>{waits.push(delay); clock+=delay;}};
  await Promise.all([gate.acquire('Vinted',options),gate.acquire('Vinted',options)]);
  assert.deepEqual(waits,[2000]);
  assert.equal(gate.snapshot('Vinted').nextAt,14000);
  await gate.acquire('OLX',options);
  assert.equal(gate.snapshot('OLX').nextAt,14000);
});

test('provider cooldown delays another same-source read, including Vinted item page reads', async () => {
  let clock=10000;
  const waits=[];
  const gate=createMarketplaceGate({intervalMs:2000});
  const options={source:'Vinted',now:()=>clock,gate,pause:async delay=>{waits.push(delay);clock+=delay;}};
  const headers={'retry-after':'120'};
  await assert.rejects(readSourceHtml('https://www.vinted.pl/catalog/2312-books',{
    ...options,fetcher:async()=>new Response('rate limited',{status:429,headers}),
  }),error=>error.status===429 && error.retryAfter===120);
  assert.equal(gate.snapshot('Vinted').cooldownUntil,130000);
  let started=false;
  const html=await readSourceHtml('https://www.vinted.pl/items/42',{
    ...options,fetcher:async()=>{started=true;return new Response('<html>ok</html>',{headers:{'content-type':'text/html'}});},
  });
  assert.equal(started,true);
  assert.equal(html,'<html>ok</html>');
  assert.deepEqual(waits,[120000]);
  assert.equal(clock,130000);
});

test('blocked challenge cools down the source without requesting CAPTCHA bypass', async () => {
  let clock=2000;
  const gate=createMarketplaceGate();
  const options={source:'Vinted',gate,now:()=>clock,pause:async delay=>{clock+=delay;}};
  await assert.rejects(readSourceHtml('https://www.vinted.pl/catalog/2312-books',{
    ...options,
    fetcher:async()=>new Response('<title>Verify you are human</title>',{status:403,headers:{'retry-after':'60'}}),
  }),e=>e.blocked===true && e.message==='SOURCE_CAPTCHA');
  assert.equal(gate.snapshot('Vinted').cooldownUntil,62000);
});

test('aborted queued request never reaches fetcher', async () => {
  const gate=createMarketplaceGate();
  const controller=new AbortController();
  const opts={source:'OLX',gate,now:()=>1000,pause:async()=>{},signal:controller.signal};
  await gate.acquire('OLX',opts);
  controller.abort();
  await assert.rejects(gate.acquire('OLX',opts),/abort|ABORT/i);
});

test('multi-minute source cooldown does not consume the 18-second fetch timeout',async()=>{
  const gate=createMarketplaceGate();
  let now=10000;
  gate.cooldown('Vinted',180,{now:()=>now});
  const waits=[];
  let fetchAborted=false;
  const result=await readSourceHtml('https://www.vinted.pl/items/900',{
    source:'Vinted',gate,now:()=>now,
    pause:async ms=>{waits.push(ms);now+=ms;},
    fetcher:async(_url,{signal})=>{
      fetchAborted=signal.aborted;
      return new Response('<html>cached item</html>',{headers:{'content-type':'text/html'}});
    },
  });
  assert.equal(result,'<html>cached item</html>');
  assert.deepEqual(waits,[180000]);
  assert.equal(fetchAborted,false);
});

test('scan cancellation aborts queued source request before any network fetch',async()=>{
  const gate=createMarketplaceGate();
  let fetched=false;
  const abort=new AbortController();
  gate.cooldown('OLX',120,{now:()=>Date.now()});
  const queued=readSourceHtml('https://www.olx.pl/d/oferta/example',{
    source:'OLX',gate,signal:abort.signal,
    pause:(_ms,_undefined,{signal})=>new Promise((_resolve,reject)=>{
      if(signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    }),
    fetcher:async()=>{fetched=true;throw Error('REQUEST_MUST_NOT_START');},
  });
  await Promise.resolve();
  abort.abort();
  await assert.rejects(queued,/abort|ABORT/i);
  assert.equal(fetched,false);
});
