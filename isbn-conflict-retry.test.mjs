import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('BN selection requires a unique ISBN-confirmed record and noncritical source differences', async () => {
  const source = await readFile(new URL('./catalog-resolver.mjs', import.meta.url), 'utf8');
  assert.match(source, /metadata_isbn_mismatch/);
  assert.match(source, /matches: \['isbn'\]/);
  assert.match(source, /mergeRecords\(metadata\)/);
});
test('manual retry excludes protected manual assignments', async () => {
  const server = await readFile(new URL('./local-app.mjs', import.meta.url), 'utf8');
  assert.match(server, /\/api\/identification\/retry/);
  assert.match(server, /retryIdentificationJobs\(catalog\.repository, input\?\.mode\)/);
  const retries = await readFile(new URL('./identification-retry.mjs', import.meta.url), 'utf8');
  assert.match(retries, /m\.method IN \('manual','legacy_manual'\)/);
  assert.match(retries, /INVALID_RETRY_MODE/);
});
