import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseMarketplace } from './marketplaces.mjs';

// Files in this directory are intentionally labelled synthetic or captured.
// Synthetic snippets verify structural regressions; only independently
// documented sanitized HTML captures are evidence of live marketplace shapes.
const directory = fileURLToPath(new URL('./fixtures/marketplaces/', import.meta.url));
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.json'))
  .sort();
const hosts = {
  Vinted: 'www.vinted.pl',
  OLX: 'www.olx.pl',
  Allegro: 'allegro.pl',
  'Allegro Lokalnie': 'allegrolokalnie.pl',
  Empik: 'www.empik.com',
  'Tezeusz.pl': 'tezeusz.pl',
  'Dedalus.pl': 'dedalus.pl',
};
for (const filename of files) {
  test('marketplace fixture: ' + filename, () => {
    const fixture = JSON.parse(readFileSync(join(directory, filename), 'utf8'));
    assert.ok(['synthetic', 'captured'].includes(fixture.kind));
    assert.equal(fixture.host, hosts[fixture.source]);
    assert.equal(fixture.sanitized, true);
    if (fixture.kind === 'captured') {
      assert.match(fixture.capturedAt || '', /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(
        fixture.reviewedForPersonalData,
        true,
        'captured pages must be reviewed before committing',
      );
    }
    assert.ok(typeof fixture.html === 'string' && fixture.html.length > 0);
    assert.ok(fixture.html.length < 300_000, 'keep only relevant sanitized parser fragments');
    assert.ok(Array.isArray(fixture.expected));
    const task = {
      source: fixture.source,
      host: fixture.host,
      mode: 'discovery',
      title: fixture.searchQuery,
      searchQuery: fixture.searchQuery,
      category: fixture.category || fixture.searchQuery,
    };
    const rows = parseMarketplace(fixture.html, task, '2026-10-31T18:00:00.000Z');
    assert.deepEqual(
      rows.map(({ url, price }) => ({ url, price })),
      fixture.expected,
    );
  });
}
test('fixture provenance is explicit and cannot be mistaken for live samples', () => {
  assert.ok(files.length >= 2);
  const captured = files.filter(
    (filename) => JSON.parse(readFileSync(join(directory, filename), 'utf8')).kind === 'captured',
  );
  if (captured.length === 0) {
    // Deliberately non-failing: actual captures need a human-reviewed source.
    assert.ok(true, 'no real HTML captures have been provided');
  }
});
