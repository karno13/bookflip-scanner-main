import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createIdentificationScheduler } from './identification-scheduler.mjs';

test('local identification starts every five seconds by default', async () => {
  const script = await readFile(new URL('./local-app.mjs', import.meta.url), 'utf8');
  assert.match(script, /BOOKFLIP_IDENTIFICATION_POLL_MS \\?\\? 5_000/);
});

test('frequent ticks do not overlap identification batches', async () => {
  let started = 0;
  let finish;
  const hold = new Promise((resolve) => { finish = resolve; });
  const scheduler = createIdentificationScheduler({ runBatch: async () => { started++; await hold; } , intervalMs: 5_000 });
  const first = scheduler.tick();
  await Promise.resolve();
  const second = scheduler.tick();
  assert.equal(started, 1);
  finish();
  await Promise.all([first, second]);
  assert.equal(started, 1);
  await scheduler.stop();
});
