import test from 'node:test';
import assert from 'node:assert/strict';
import { scanCancelled, awaitScan } from '../scan-cancellation.mjs';
test('aborted operations stop without awaiting an unfinished source request', async () => {
  const controller = new AbortController();
  const work = new Promise(() => {});
  const task = awaitScan(work, controller.signal);
  controller.abort();
  await assert.rejects(task, /SCAN_CANCELLED/);
  assert.throws(() => scanCancelled(controller.signal), /SCAN_CANCELLED/);
});
test('successful source work keeps its original result', async () => {
  const controller = new AbortController();
  assert.equal(await awaitScan(Promise.resolve(42), controller.signal),42);
});
