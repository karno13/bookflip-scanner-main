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
  assert.match(script, /async function loadCatalogPage\(kind,\{reset=false\}=\{\}\)/);
  assert.match(script, /offset=\$\{offset\}/);
  assert.match(script, /INCOMPLETE_CATALOG_PAGE/);
  assert.match(script, /data-load-catalog-kind/);
  assert.match(script, /catalogPageSize = 250/);
  assert.doesNotMatch(script, /CATALOG_PAGE_LIMIT_EXCEEDED/);
  assert.match(script, /CATALOG_CHANGED_DURING_PAGINATION/);
  assert.match(script, /state\.catalog\?\.enabled === false \? \(state\.history\?\.offers \|\| \[\]\) : state\.sqliteOffers/);
  assert.doesNotMatch(script, /state\.sqliteOffers\.length \? state\.sqliteOffers :/);
  assert.match(script, /Nie udało się wczytać katalogu SQLite/);
});


test('book-centric UI exposes comparison and mobile offers without external images', () => {
  assert.match(script, /comparison-candidate/);
  assert.match(script, /reviewCandidateMarkup\(offer, suggested\)/);
  assert.match(script, /offersMobileList/);
  assert.match(script, /data-mobile-offer-id/);
  assert.match(html, /id="offersMobileList"/);
  assert.match(styles, /\.mobile-offer/);
  assert.match(styles, /\.book-spine/);
});

test('scanner previews persisted offers separately from scan-session metrics', () => {
  assert.match(html, /id="scannerOfferList"/);
  assert.match(html, /id="scannerBrowseOffers"/);
  assert.match(script, /function renderScannerOffers\(\)/);
  assert.match(script, /Nie są to wyniki bieżącego skanu/);
  assert.match(script, /data-scanner-offer-id/);
  assert.match(script, /openOfferDrawer\(button\.dataset\.scannerOfferId\)/);
  assert.match(styles, /\.scanner-offer-row/);
});

test('review compares observed ISBN against candidate edition and warns on conflicts', () => {
  assert.match(script, /function normalizedIsbn\(value\)/);
  assert.match(script, /function reviewCandidateMarkup\(offer, suggested\)/);
  assert.match(script, /RÓŻNE ISBN — sprawdź wydanie/);
  assert.match(script, /Konflikt ISBN — wybierz wydanie ręcznie/);
  assert.match(script, /input\.dataset\.editionId = ''/);
  assert.match(styles, /\.verification-conflict/);
  assert.match(styles, /\.verification-match/);
});

test('scanner saved-offer search and source filter are separated from scan counters', () => {
  assert.match(html, /id="scannerOfferSearch"/);
  assert.match(html, /id="scannerOfferSource"/);
  assert.match(html, /id="scannerOfferCount"/);
  assert.match(script, /sourceSelect\.value/);
  assert.match(script, /filtered\.slice\(0, 12\)/);
  assert.match(script, /scannerOfferSearch'\)\.addEventListener\('input', renderScannerOffers\)/);
  assert.match(styles, /\.scanner-discover-toolbar/);
});


test('desktop workspace preserves functional scanner controls and adds editorial shell', () => {
  assert.match(html, /class="sidebar-collection"/);
  assert.match(html, /class="desktop-scanner-grid"/);
  assert.match(html, /id="sourceGrid"/);
  assert.match(html, /id="startSearch"/);
  assert.match(html, /id="scanProgressPanel"/);
  assert.match(html, /id="scannerOfferList"/);
  assert.match(styles, /\.scanner-offer-list\{display:grid;grid-template-columns:repeat\(2/);
  assert.match(styles, /@media\(min-width:761px\)/);
});

test('mobile repairs keep scanner filters usable and catalog avoids cramped headers', () => {
  assert.match(styles, /\.scanner-discover-toolbar\{display:grid!important/);
  assert.match(styles, /\.catalog-table-header\{display:none!important/);
  assert.match(styles, /\.catalog-row\{display:grid!important/);
  assert.match(styles, /\.stats-grid \.metric\{min-height:82px/);
  assert.match(styles, /@media\(max-width:400px\)/);
});


test('edition price statistics reflect saved asking prices without projecting ROI', () => {
  assert.match(script, /function offerPriceSummary\(offers = \[\]\)/);
  assert.match(script, /function priceStats\(prices\)/);
  assert.match(script, /sorted\.length % 2/);
  assert.match(script, /offerPriceSummaryMarkup\(row\.offers\)/);
  assert.match(script, /Nie są to ceny sprzedaży ani prognoza zysku/);
  assert.match(styles, /\.edition-price-summary/);
});
test('review requires explicit edition decision with bibliographic context', () => {
  assert.match(script, /Dopasowanie dotyczy konkretnego wydania/);
  assert.match(script, /Wybierz wydanie i zdecyduj/);
  assert.match(script, /Zatwierdz przypisanie/);
});

test('offer drawer reports price observations without treating them as sales', () => {
  assert.match(script, /function priceEvidenceMarkup\(offer\)/);
  assert.match(script, /Obserwacje cen/);
  assert.match(script, /Minimum historyczne/);
  assert.match(script, /Mediana obserwacji/);
  assert.match(script, /Wielokrotne odczyty tej samej ceny nie są niezależnymi transakcjami/);
  assert.match(script, /priceEvidenceMarkup\(offer\)/);
});


test('resale simulator requires user costs and a manually assumed resale price', () => {
  assert.match(script, /function scenarioCalculatorMarkup\(offer\)/);
  assert.match(script, /function calculateScenario\(\)/);
  assert.match(script, /scenarioPurchase/);
  assert.match(script, /scenarioShipping/);
  assert.match(script, /scenarioOther/);
  assert.match(script, /scenarioResale/);
  assert.match(script, /Uzupełnij wszystkie pola/);
  assert.match(script, /Przed podatkiem, bez gwarancji sprzedaży/);
  assert.match(styles, /\.scenario-fields/);
});


test('covers use ISBN checksum and show neutral spine until real image loads', () => {
  assert.match(script, /function validCoverIsbn\(value\)/);
  assert.match(script, /function coverPreviewMarkup\(identifiers=\[\]\)/);
  assert.match(script, /covers\.openlibrary\.org\/b\/isbn/);
  assert.match(script, /default=false/);
  assert.match(script, /referrerpolicy="no-referrer"/);
  assert.match(script, /naturalWidth>1/);
  assert.match(styles, /\.cover-preview\.has-cover/);
  assert.match(styles, /\.edition-identity/);
});

test('manual refresh never announces success after SQLite load or status failure', () => {
  assert.match(script, /async function loadCatalogData\(\)/);
  assert.match(script, /return false;/);
  assert.match(script, /Promise\.allSettled\(\[loadHistory\(\), loadCatalogStatus\(\), loadCatalogData\(\)\]\)/);
  assert.match(script, /catalogResult\.value !== true/);
  assert.match(script, /catalogDataOk\.value !== true/);
  assert.match(script, /Nie wszystkie dane odświeżono/);
  assert.match(script, /finally \{ button\.disabled = false; \}/);
});

test('price evidence shares one numeric validator with edition summary', () => {
  assert.match(script, /return priceStats\(offers\.map\(item => item\.currentPrice\)\)/);
  assert.match(script, /const stats = priceStats\(observations\.map\(item => item\.price\)\)/);
  assert.match(script, /Number\.isFinite\(value\) && value >= 0/);
  assert.doesNotMatch(script, /const first = prices\.length/);
});
