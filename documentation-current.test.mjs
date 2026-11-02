import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

test('active documentation reflects persistent storage and six workspaces', async () => {
  const read = async (file) => readFile(new URL(file, import.meta.url), 'utf8');
  const readme = await read('./README.md');
  const migration = await read('./docs/DATA-MIGRATION.md');
  const production = await read('./PRODUCTION-CATALOG.md');
  assert.match(readme, /Sześć obszarów aplikacji/);
  assert.match(readme, /%LOCALAPPDATA%/);
  assert.match(readme, /Zestawy/);
  assert.match(migration, /pustą bazę/);
  assert.match(production, /bezpośrednio do SQLite/);
  assert.match(production, /Nie ma produkcyjnego dual-write/);
});

test('dead hosted workflow is no longer installed', async () => {
  await assert.rejects(access(new URL('./.github/workflows/bookflip-scan.yml', import.meta.url)));
});

test('obsolete UI audit assets and hosted-runner docs are not shipped', async () => {
  for (const path of [
    './artifacts/frontend-audit/scanner-1366x768.png',
    './artifacts/audit-verification-flow/01-review-list.png',
    './docs/archive/README-legacy-github-runner.md',
    './docs/archive/AUDIT-2026-10-25.md',
  ]) {
    await assert.rejects(access(new URL(path, import.meta.url)));
  }
  // Keep migration reference documentation for historical JSON recovery.
  await access(new URL('./docs/archive/DATA-MIGRATION-LEGACY.md', import.meta.url));
});
