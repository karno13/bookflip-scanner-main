import test from 'node:test';
import assert from 'node:assert/strict';
import { json } from './api.js';

test('JSON API returns parsed successful payload', async () => {
  assert.deepEqual(await json('/example', undefined, async () => ({
    ok: true, json: async () => ({ value: 5 }),
  })), { value: 5 });
});
test('JSON API exposes a server error code', async () => {
  await assert.rejects(json('/example', undefined, async () => ({
    ok: false, status: 503, json: async () => ({ error: 'CATALOG_DISABLED' }),
  })), /CATALOG_DISABLED/);
});
