import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('BN selection requires a unique ISBN-confirmed record and noncritical source differences', async () => {
  const source = await readFile(new URL('./catalog-resolver.mjs', import.meta.url), 'utf8');
  assert.match(source, /bnRecords\.length === 1 && isbnMatches\(bnRecords\[0\]\)/);
  assert.match(source, /'title', 'authors', 'publicationYear'/);
  assert.match(source, /mergeRecords\(metadata, bnPreferred\)/);
});
test('manual retry excludes protected manual assignments', async () => {
  const server = await readFile(new URL('./local-app.mjs', import.meta.url), 'utf8');
  assert.match(server, /\/api\/identification\/retry/);
  assert.match(server, /m\.method IN \('manual','legacy_manual'\)/);
  assert.match(server, /INVALID_RETRY_MODE/);
});
