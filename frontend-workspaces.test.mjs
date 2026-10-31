import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html = await readFile(new URL('./app/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('./app/app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('./app/styles.css', import.meta.url), 'utf8');

test('desktop shell exposes exactly the five requested workspaces in order', () => {
  const views = [...html.matchAll(/class="nav-item(?: active)?"[^>]+data-view="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(views, ['scanner', 'review', 'catalog', 'offers', 'settings']);
  assert.match(html, /id="view-scanner"[^>]+class="view active"|class="view active"[^>]+id="view-scanner"/);
  assert.doesNotMatch(html, /data-view="history"/);
});

test('scanner state is module-owned and navigation does not recreate it', () => {
  assert.match(script, /scan:\s*\{running:\s*false/);
  assert.match(script, /if \(state\.scan\.running\) return/);
  assert.match(script, /showView\(button\.dataset\.view\)/);
  assert.match(script, /readSearchStream/);
});

test('frontend uses local JSON compatibility and SQLite catalog APIs', () => {
  for (const endpoint of ['/api/sources', '/api/history', '/api/catalog/status', '/api/catalog/works', '/api/identification-jobs', '/api/offers', '/api/catalog/lookup-preview', '/api/catalog/lookup-confirm', '/api/catalog', '/api/search?stream=1']) assert.ok(script.includes(endpoint));
  assert.match(script, /id="markNotBook"/);
  assert.match(script, /decideReview\('not_book'\)/);
  assert.match(script, /state\.catalogPreview/);
});

test('layout has fixed desktop navigation and responsive workspaces', () => {
  assert.match(styles, /grid-template-columns:236px minmax\(0,1fr\)/);
  assert.match(styles, /height:100vh/);
  assert.match(styles, /@media\(max-width:1100px\)/);
  assert.match(styles, /@media\(max-width:760px\)/);
});

test('review catalog picker filters by typed title or ISBN before selection', () => {
  assert.match(script, /id=\"reviewBookSearch\"/);
  assert.match(script, /renderReviewBookChoices\(event\.target\.value\)/);
  assert.match(script, /work\.title[\s\S]*edition\.identifiers/);
  assert.match(script, /dataset\.reviewEditionId/);
  assert.match(styles, /\.book-options/);
});


test('catalog loads beyond the first SQLite page without silent JSON substitution', () => {
  assert.match(script, /async function loadCatalogPages\(endpoint, maxPages = 40\)/);
  assert.match(script, /offset=\$\{page \* limit\}/);
  assert.match(script, /INCOMPLETE_CATALOG_PAGE/);
  assert.match(script, /CATALOG_CHANGED_DURING_PAGINATION/);
  assert.match(script, /state\.catalog\?\.enabled === false \? \(state\.history\?\.offers \|\| \[\]\) : state\.sqliteOffers/);
  assert.doesNotMatch(script, /state\.sqliteOffers\.length \? state\.sqliteOffers :/);
  assert.match(script, /Nie udało się wczytać katalogu SQLite/);
});
