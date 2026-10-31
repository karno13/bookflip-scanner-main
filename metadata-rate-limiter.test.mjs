import assert from 'node:assert/strict';
import test from 'node:test';

import { SourceRateLimiter,createJsonRequester } from './metadata-http.mjs';

test('each metadata source limiter defaults to at most one request per second', async () => {
  let clock = 0;
  const waits = [];
  const limiter = new SourceRateLimiter({
    now: () => clock,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
  });

  await limiter.acquire();
  await limiter.acquire();
  await limiter.acquire();
  assert.deepEqual(waits, [1_000, 1_000]);
});

test('programmer TypeError is not retried as a temporary metadata network error',async()=>{
 let calls=0,waits=0;
 const fetcher=async()=>{calls++;throw new TypeError('Cannot read properties of undefined (reading isbn)')};
 const request=createJsonRequester({fetcher,retries:2,limiter:new SourceRateLimiter({minIntervalMs:0}),wait:async()=>{waits++}});
 const result=await request('https://example.test/isbn');
 assert.equal(result.status,'invalid_response');
 assert.equal(calls,1);
 assert.equal(waits,0);
});
test('network TypeError still retries under the configured limit',async()=>{
 let calls=0;
 const request=createJsonRequester({
  fetcher:async()=>{calls++;throw new TypeError('fetch failed')},
  retries:2,limiter:new SourceRateLimiter({minIntervalMs:0}),wait:async()=>{}
 });
 const result=await request('https://example.test/isbn');
 assert.equal(result.status,'temporary_error');
 assert.equal(calls,3);
});
