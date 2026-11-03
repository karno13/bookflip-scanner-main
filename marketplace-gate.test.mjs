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
