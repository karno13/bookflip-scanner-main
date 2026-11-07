import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('./app/index.html', import.meta.url), 'utf8');
const shellScript = await readFile(new URL('./app/app.js', import.meta.url), 'utf8');
const scannerScript = await readFile(new URL('./app/views/scanner.js', import.meta.url), 'utf8');
// Static coverage spans the shell and the scanner module after refactoring.
const reviewScript = await readFile(new URL('./app/views/review.js', import.meta.url), 'utf8');
const catalogScript = await readFile(new URL('./app/views/catalog.js', import.meta.url), 'utf8');
const offersScript = await readFile(new URL('./app/views/offers.js', import.meta.url), 'utf8');
const script = [shellScript, scannerScript, reviewScript, catalogScript, offersScript].join('\n');
const styles = (await Promise.all(['app.css'].map(file => readFile(new URL('./app/' + file, import.meta.url), 'utf8')))).join('\n');

test('desktop shell exposes all six workspaces in order', () => {
  const views = [...html.matchAll(/class="nav-item(?: active)?"[^>]+data-view="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(views, ['scanner', 'offers', 'review', 'catalog', 'sets', 'settings']);
  assert.match(
    html,
    /id="view-scanner"[^>]+class="view active"|class="view active"[^>]+id="view-scanner"/,
  );
  assert.doesNotMatch(html, /data-view="history"/);
});

test('scanner state is module-owned and navigation does not recreate it', () => {
  const compact=script.replace(/\s+/g,'');
  for(const expression of ['scan:{running:false','if(state.scan.running)return','showView(button.dataset.view)','readSearchStream'])assert.ok(compact.includes(expression),expression);
});

test('frontend uses SQLite catalog APIs', () => {
  for (const endpoint of [
    '/api/sources',
    '/api/history',
    '/api/catalog/status',
    '/api/catalog/works',
    '/api/identification-jobs',
    '/api/offers',
    '/api/catalog/lookup-preview',
    '/api/catalog/lookup-confirm',
    '/api/catalog',
    '/api/search?stream=1',
  ])
    assert.ok(script.includes(endpoint));
  assert.match(script, /id="rejectReview"/);
  assert.doesNotMatch(script, /id="reviewRejectReason"/);
  assert.match(script, /decideReview\('excluded'/);
  assert.match(script, /state\.catalogPreview/);
});

test('layout has fixed desktop navigation and responsive workspaces', () => {
  assert.match(styles, /\.nav-list\{display:flex/);
  assert.match(styles, /@media\(max-width:900px\)/);
  assert.match(styles, /\.mobile-bottom-nav\{display:grid/);
  assert.match(styles, /\.detail-is-open #reviewDetail/);
});

test('review catalog picker filters by typed title or ISBN before selection', () => {
  assert.match(script, /id=\"reviewBookSearch\"/);
  assert.match(script, /renderReviewBookChoices\(event\.target\.value\)/);
  assert.match(script, /work\.title[\s\S]*edition\.identifiers/);
  assert.match(script, /dataset\.reviewEditionId/);
  assert.match(styles, /\.book-options/);
});

test('catalog loads beyond the first SQLite page without silent JSON substitution', () => {
  const compact=script.replace(/\s+/g,'');
  for(const expression of ['asyncfunctionloadCatalogPage(kind,{reset=false,pageNumber=null}={})','newURLSearchParams({limit:String(limit),offset:String(offset)})','INCOMPLETE_CATALOG_PAGE','data-load-catalog-kind','catalogPageSize=250','CATALOG_CHANGED_DURING_PAGINATION','functionallOffers(){returnstate.sqliteOffers;}','NieudałosięwczytaćkataloguSQLite'])assert.ok(compact.includes(expression),expression);
  assert.doesNotMatch(script,/CATALOG_PAGE_LIMIT_EXCEEDED|state\.sqliteOffers\.length\s*\?/);
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
  for (const id of ['sourceGrid','startSearch','scanProgressPanel','scannerOfferList']) assert.ok(html.includes('id=\"'+id+'\"'));
  assert.match(styles, /#view-scanner\{display:grid/);
  assert.match(styles, /#view-scanner>\.scanner-discover\{grid-column:2/);
});

test('mobile repairs keep scanner filters usable and catalog avoids cramped headers', () => {
  assert.match(styles, /\.filterbar \.search-field\{flex-basis:100%/);
  assert.match(styles, /\.catalog-table-header,\.catalog-isbn\{display:none/);
  assert.match(styles, /\.catalog-row\{display:grid/);
  assert.match(styles, /\.stats-grid\{display:flex/);
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
  assert.match(script, /Sprawdź ISBN/);
  assert.match(script, /Pozycja z katalogu/);
  assert.match(script, /id="approveReview"/);
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
  const compact=script.replace(/\s+/g,'');
  for(const expression of ['functionvalidCoverIsbn(value)','functioncoverPreviewMarkup(identifiers=[])','covers.openlibrary.org/b/isbn','default=false','referrerpolicy="no-referrer"','naturalWidth>1'])assert.ok(compact.includes(expression),expression);
  assert.match(styles,/\.cover-preview\.has-cover/);
  assert.match(styles,/\.edition-identity/);
});

test('manual refresh never announces success after SQLite load or status failure', () => {
  const compact=script.replace(/\s+/g,'');
  for(const expression of ['asyncfunctionloadCatalogData()','returnfalse;','Promise.allSettled([loadHistory(),loadCatalogStatus(),loadCatalogData(),])','catalogResult.value!==true','catalogDataOk.value!==true','Nie wszystkiedaneodświeżono'.replace(/\s+/g,''),'finally{button.disabled=false;}'])assert.ok(compact.includes(expression),expression);
});

test('price evidence shares one numeric validator with edition summary', () => {
  const compact=script.replace(/\s+/g,'');
  for(const expression of ["returnpriceStats(offers.filter(item=>item.availability!=='unavailable'&&(!item.currency||item.currency==='PLN')).map((item)=>item.currentPrice))",'conststats=priceStats(observations.map((item)=>item.price))','Number.isFinite(value)&&value>=0'])assert.ok(compact.includes(expression),expression);
  assert.doesNotMatch(script,/const first = prices\.length/);
});

test('catalog search sends debounced SQLite queries beyond loaded pages', () => {
  const compact=script.replace(/\s+/g,'');
  for(const kind of ['works','jobs','offers'])assert.ok(compact.includes("scheduleGlobalCatalogSearch('"+kind+"')"));
  for(const expression of ['for(const[key,value]ofObject.entries(filters))if(value)params.set(key,value)','catalogAbortControllers.get(kind)?.abort()','newURLSearchParams({limit:String(limit),offset:String(offset)})','state.catalogPages[kind]={total:data.total,offset:offset+data.items.length,query,filters,}'])assert.ok(compact.includes(expression),expression);
});

test('review and catalog DOM rendering is bounded despite loading many SQLite pages', () => {
  const compact=script.replace(/\s+/g,'');
  for(const expression of ['visibleRows:{works:100,jobs:100}','functionvisibleCatalogRows(kind,rows)','rows.slice(0,visible)','state.visibleRows[kind]+=100',"visibleCatalogRows('works',rows).map((row)", "visibleCatalogRows('jobs',rows).map((job)",'data-show-loaded-kind'])assert.ok(compact.includes(expression),expression);
});

test('filter and sort controls query the full SQLite catalogue instead of only loaded rows', () => {
  const compact=script.replace(/\s+/g,'');
  for(const expression of ['functioncatalogFilters(kind)','for(const[key,value]ofObject.entries(filters))if(value)params.set(key,value)',"page.filters||{query:page.query||''}"])assert.ok(compact.includes(expression),expression);
  for(const kind of ['works','jobs','offers'])assert.ok(compact.includes("scheduleGlobalCatalogSearch('"+kind+"')"));
});

test('active navigation exposes current page to assistive technology', () => {
  assert.match(script, /button\.setAttribute\('aria-current', 'page'\)/);
  assert.match(script, /button\.removeAttribute\('aria-current'\)/);
  assert.match(html, /class="nav-list" aria-label="Główna nawigacja"/);
});
