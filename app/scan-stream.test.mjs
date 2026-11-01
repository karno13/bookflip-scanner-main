import test from 'node:test';
import assert from 'node:assert/strict';
import { readSearchStream } from './scan-stream.js';

function streamed(chunks) {
  const encoder = new TextEncoder();
  return { body: new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }) };
}

test('scan stream handles split UTF-8 JSON lines and progress', async () => {
  const events = [];
  const response = streamed([
    '{"type":"pro',
    'gress","event":{"type":"source-start"}}\n',
    '{"type":"result","result":{"summary":{"offers":2}}}\n',
  ]);
  const result = await readSearchStream(response, (event) => events.push(event));
  assert.equal(result.summary.offers, 2);
  assert.equal(events[0].type, 'source-start');
});

test('scan stream reports errors or missing results', async () => {
  await assert.rejects(readSearchStream(streamed(['{"type":"error","error":"SCAN_FAILED"}\n'])), /SCAN_FAILED/);
  await assert.rejects(readSearchStream(streamed([])), /SEARCH_FAILED/);
});
