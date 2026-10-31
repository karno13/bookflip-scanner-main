import assert from 'node:assert/strict';
import test from 'node:test';

import { SourceRateLimiter } from './metadata-http.mjs';

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
