import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defaultHistoryPath } from './offer-history.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(root, name), 'utf8');
test('legacy history remains stable while catalog is stored in user data directory', () => {
  assert.equal(defaultHistoryPath, join(root, 'scan-results', 'local-offer-history.json'));
  assert.match(
    read('catalog-production.mjs'),
    /databasePath = defaultCatalogPath\(\)/,
  );
  assert.match(read('local-app.mjs'), /fileURLToPath\(new URL\('\.\/scan-results\/local-app\.log'/);
});
test('manual connectivity workflows never auto-run or submit shop cart POST', () => {
  const source = read('.github/workflows/source-connectivity.yml');
  const buyback = read('.github/workflows/buyback-test.yml');
  for (const content of [source, buyback]) {
    assert.match(content, /workflow_dispatch:/);
    assert.doesNotMatch(content, /\n  push:/);
    assert.doesNotMatch(content, /\n  schedule:/);
  }
  assert.doesNotMatch(buyback, /method=['"]POST['"]|--data|--request POST/);
});
test('local Windows launcher requires supported Node and project declares runtime', () => {
  const cmd = read('Uruchom BookFlip Scanner.cmd');
  const pkg = JSON.parse(read('package.json'));
  assert.match(cmd, /process\.versions\.node/);
  assert.equal(pkg.private, true);
  assert.equal(pkg.engines.node, '>=24');
  assert.equal(pkg.scripts.test, 'node --test');
});
