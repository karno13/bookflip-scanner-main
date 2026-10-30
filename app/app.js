const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
  activeView: 'scanner', sources: [], history: null, catalog: null,
  scan: {running: false, startedAt: null, timer: null, total: 0, completed: 0, rows: new Map(), result: null, fingerprint: null, lastStart: 0},
  selectedReviewId: null, selectedCatalogId: null, offerPage: 1, pageSize: 25,
};

const savedSearch = JSON.parse(localStorage.getItem('bookflip-search') || 'null');
$('#queries').value = savedSearch?.queries?.join('\n') || '';

function escapeHtml(value) { const node = document.createElement('span'); node.textContent = String(value ?? ''); return node.innerHTML; }
function money(value) { return value == null ? '-' : new Intl.NumberFormat('pl-PL', {style: 'currency', currency: 'PLN'}).format(value / 100); }
function date(value) { return value ? new Date(value).toLocaleString('pl-PL') : '-'; }
function shortTime(value) { return value ? new Date(value).toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit'}) : '-'; }
function toast(message) { const node = document.createElement('div'); node.className = 'toast'; node.textContent = message; $('#toastRegion').append(node); setTimeout(() => node.remove(), 4200); }
async function json(url, options) { const response = await fetch(url, options); const data = await response.json(); if (!response.ok) throw Error(data.error || `HTTP_${response.status}`); return data; }
function selectedSources() { return $$('#sourceGrid input:checked').map(input => input.value); }
function readQueries() { return [...new Set($('#queries').value.split(/\n|,/).map(value => value.trim()).filter(Boolean))].slice(0, 10); }
function bookFor(id) { return (state.history?.books || []).find(row => row.book.id === id)?.book || null; }
function allOffers() { return state.history?.offers || []; }
function reviewOffers() { return allOffers().filter(offer => offer.linkMode !== 'manual'); }

function showView(name) {
  if (!['scanner', 'review', 'catalog', 'offers', 'settings'].includes(name)) name = 'scanner';
  state.activeView = name;
  $$('.view').forEach(view => { view.hidden = view.id !== `view-${name}`; view.classList.toggle('active', !view.hidden); });
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  $('#viewTitle').textContent = $(`#view-${name}`).dataset.title;
  history.replaceState(null, '', name === 'scanner' ? '/' : `/?view=${name}`);
  if (name === 'review') renderReview();
  if (name === 'catalog') renderCatalog();
  if (name === 'offers') renderOffers();
  if (name === 'settings') renderSettings();
}

async function loadSources() {
  const data = await json('/api/sources'); state.sources = data.sources || [];
  const chosen = new Set(savedSearch?.sources || state.sources);
  $('#sourceGrid').innerHTML = state.sources.map(source => `<label class="source-option"><input type="checkbox" value="${escapeHtml(source)}" ${chosen.has(source) ? 'checked' : ''}><span>${escapeHtml(source)}</span></label>`).join('') || '<span class="loading-copy">Brak aktywnych adapterow.</span>';
  $('#settingsSources').innerHTML = state.sources.map(source => `<span><b>${escapeHtml(source)}</b><small>Aktywny adapter</small></span>`).join('');
  fillSourceFilters();
}

function fillSourceFilters() {
  const options = state.sources.map(source => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join('');
  for (const selector of ['#reviewSource', '#offerSource']) { const select = $(selector); const value = select.value; select.innerHTML = `<option value="">Wszystkie zrodla</option>${options}`; select.value = value; }
}

async function loadHistory() {
  state.history = await json('/api/history');
  $('#offersNavCount').textContent = `${allOffers().length} zapisanych`;
  $('#reviewNavCount').textContent = `${reviewOffers().length} pozycji`;
  renderReview(); renderCatalog(); renderOffers();
}

async function loadCatalogStatus() {
  try {
    state.catalog = await json('/api/catalog/status'); const counts = state.catalog.counts || {};
    $('#databaseStatus').textContent = `SQLite: ${counts.works || 0} dziel / ${counts.editions || 0} wydan`;
    $('#catalogWorks').textContent = counts.works || 0; $('#catalogEditions').textContent = counts.editions || 0;
    $('#catalogIncomplete').textContent = counts.identification_jobs || 0;
    $('#settingsDatabaseCopy').textContent = state.catalog.enabled ? 'Baza lokalna jest dostepna.' : 'Integracja katalogu jest wylaczona.';
    $('#settingsDatabaseStats').innerHTML = Object.entries(counts).slice(0, 8).map(([key, value]) => `<span><b>${escapeHtml(key.replaceAll('_', ' '))}</b><small>${value}</small></span>`).join('');
    $('#connectionDot').classList.add('online'); $('#connectionLabel').textContent = 'Aplikacja online';
  } catch {
    state.catalog = null; $('#databaseStatus').textContent = 'SQLite: niedostepny'; $('#settingsDatabaseCopy').textContent = 'Nie udalo sie odczytac statusu bazy.';
    $('#connectionDot').classList.remove('online'); $('#connectionLabel').textContent = 'Blad polaczenia';
  }
}

function resetScanUi(queries, sources) {
  state.scan.total = queries.length * sources.length; state.scan.completed = 0; state.scan.rows = new Map();
  for (const source of sources) state.scan.rows.set(source, {source, status: 'Oczekuje', offers: 0, completed: 0, tasks: queries.length, error: '', finishedAt: null});
  $('#scanProgressPanel').hidden = false; $('#progressTrack').dataset.indeterminate = 'false'; $('#progressBar').style.width = '0%';
  $('#scanStateBadge').textContent = 'Skanowanie'; $('#scanStateBadge').className = 'state-badge warning';
  for (const id of ['statFound', 'statNew', 'statUpdated', 'statPriceChanges', 'statErrors']) $(`#${id}`).textContent = '0';
  renderSourceRows();
}

function renderSourceRows() {
  const rows = [...state.scan.rows.values()];
  $('#sourceStatusBody').innerHTML = rows.length ? rows.map(row => `<tr><td><strong>${escapeHtml(row.source)}</strong><span class="offer-subtitle">${row.completed}/${row.tasks} zadan</span></td><td><span class="status-pill ${row.error ? 'error' : row.completed === row.tasks ? 'success' : row.status === 'Oczekuje' ? 'neutral' : 'warning'}">${escapeHtml(row.status)}</span></td><td>${row.offers}</td><td>-</td><td>${shortTime(row.finishedAt)}</td><td>${escapeHtml(row.error || '-')}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">Uruchom skan, aby zobaczyc statusy zrodel.</td></tr>';
}

function updateProgress(event) {
  const row = state.scan.rows.get(event.source);
  if (event.type === 'source-start' && row) { row.status = 'Skanowanie'; $('#progressMessage').textContent = `${event.source}: ${event.query}`; $('#progressDetail').textContent = 'Laczenie ze zrodlem'; }
  if (event.type === 'page-start') { $('#progressMessage').textContent = `${event.source}: ${event.query}`; $('#progressDetail').textContent = `Pobieranie strony ${event.page}`; }
  if (event.type === 'page-done' && row) { $('#progressDetail').textContent = `Strona ${event.page}: ${event.count} ofert`; }
  if (event.type === 'language-progress') $('#progressDetail').textContent = `Weryfikacja jezyka ${event.checked}/${event.total}`;
  if (event.type === 'retry' && row) { row.status = 'Ponawianie'; row.error = event.code || 'Blad tymczasowy'; $('#progressDetail').textContent = `Ponowienie ${event.attempt}/${event.maxAttempts}`; }
  if (event.type === 'source-error' && row) { row.error = event.code || 'SOURCE_ERROR'; row.status = event.partial ? 'Czesciowy' : 'Blad'; }
  if (event.type === 'source-done' && row) { row.completed += 1; row.offers += Number(event.offers || 0); row.status = event.status === 'ok' && row.completed === row.tasks ? 'Zakonczony' : event.status === 'ok' ? 'Skanowanie' : 'Czesciowy'; row.finishedAt = new Date().toISOString(); state.scan.completed += 1; }
  const found = [...state.scan.rows.values()].reduce((sum, item) => sum + item.offers, 0); $('#statFound').textContent = found;
  $('#statErrors').textContent = [...state.scan.rows.values()].filter(item => item.error).length;
  const percent = state.scan.total ? Math.min(100, Math.round(state.scan.completed / state.scan.total * 100)) : 0; $('#progressBar').style.width = `${percent}%`; $('#progressDetail').textContent += ` - ${state.scan.completed}/${state.scan.total} zadan`;
  renderSourceRows();
}

async function readSearchStream(response) {
  if (!response.body) throw Error('STREAM_UNAVAILABLE');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', result = null, failure = null;
  const consume = line => { if (!line.trim()) return; const data = JSON.parse(line); if (data.type === 'progress') updateProgress(data.event); if (data.type === 'result') result = data.result; if (data.type === 'error') failure = data.error; };
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, {stream: true}); const lines = buffer.split('\n'); buffer = lines.pop(); lines.forEach(consume); }
  if (buffer.trim()) consume(buffer); if (failure) throw Error(failure); if (!result) throw Error('SEARCH_FAILED'); return result;
}

async function startSearch() {
  if (state.scan.running) return;
  const queries = readQueries(), sources = selectedSources();
  if (!queries.length) return toast('Dodaj przynajmniej jedna fraze.');
  if (!sources.length) return toast('Wybierz przynajmniej jedno zrodlo.');
  const fingerprint = JSON.stringify({queries, sources: [...sources].sort()});
  if (state.scan.fingerprint === fingerprint && Date.now() - state.scan.lastStart < 5000) return toast('Ten sam skan zostal przed chwila uruchomiony.');
  state.scan.running = true; state.scan.fingerprint = fingerprint; state.scan.lastStart = Date.now(); state.scan.startedAt = Date.now();
  localStorage.setItem('bookflip-search', JSON.stringify({queries, sources})); resetScanUi(queries, sources);
  $('#startSearch').disabled = true; $('#startSearch').textContent = 'Skanowanie...'; $('#scanGuardMessage').textContent = 'Mozesz zmieniac zakladki - skan bedzie kontynuowany.';
  state.scan.timer = setInterval(() => { $('#progressElapsed').textContent = `${Math.floor((Date.now() - state.scan.startedAt) / 1000)} s`; }, 1000);
  try {
    const response = await fetch('/api/search?stream=1', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({queries, sources})});
    if (!response.ok) throw Error(`SEARCH_HTTP_${response.status}`);
    state.scan.result = await readSearchStream(response);
    state.scan.completed = state.scan.total; $('#progressBar').style.width = '100%'; $('#progressMessage').textContent = 'Skan zakonczony';
    const summary = state.scan.result.summary || {}, last = state.scan.result.lastScan || {};
    $('#statFound').textContent = summary.offers || last.found || 0; $('#statNew').textContent = summary.newOffers || last.newOffers || 0;
    $('#statUpdated').textContent = Math.max(0, (summary.offers || 0) - (summary.newOffers || 0)); $('#statPriceChanges').textContent = summary.priceChanges || last.priceChanges || 0;
    $('#statErrors').textContent = (state.scan.result.results || []).filter(row => row.status !== 'ok').length;
    $('#scanStateBadge').textContent = 'Zakonczony'; $('#scanStateBadge').className = 'state-badge neutral'; $('#goToOffers').disabled = false;
    await Promise.all([loadHistory(), loadCatalogStatus()]); renderSourceRows(); toast(`Skan zakonczony: ${summary.offers || 0} ofert.`);
  } catch (error) {
    $('#progressMessage').textContent = 'Skan przerwany'; $('#progressDetail').textContent = error.message; $('#scanStateBadge').textContent = 'Blad'; $('#scanStateBadge').className = 'state-badge warning'; toast(`Nie udalo sie wykonac skanu: ${error.message}`);
  } finally {
    clearInterval(state.scan.timer); state.scan.running = false; $('#startSearch').disabled = false; $('#startSearch').textContent = 'Uruchom skan'; $('#scanGuardMessage').textContent = '';
  }
}

function filteredReviewOffers() {
  const query = $('#reviewSearch').value.trim().toLocaleLowerCase('pl'), source = $('#reviewSource').value, isbn = $('#reviewIsbn').value;
  const rows = reviewOffers().filter(offer => (!query || `${offer.originalTitle} ${offer.source} ${offer.isbn || ''}`.toLocaleLowerCase('pl').includes(query)) && (!source || offer.source === source) && (!isbn || (isbn === 'present') === Boolean(offer.isbn)));
  return rows.sort((a, b) => $('#reviewSort').value === 'price' ? a.currentPrice - b.currentPrice : String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

function renderReview() {
  if (!state.history) return; const rows = filteredReviewOffers();
  $('#reviewCount').textContent = `${rows.length} oczekujacych`; $('#reviewNavCount').textContent = `${reviewOffers().length} pozycji`;
  if (state.selectedReviewId && !rows.some(row => row.id === state.selectedReviewId)) state.selectedReviewId = null;
  $('#reviewList').innerHTML = rows.length ? rows.map(offer => `<button class="review-item ${offer.id === state.selectedReviewId ? 'active' : ''}" type="button" data-review-id="${escapeHtml(offer.id)}"><input type="checkbox" tabindex="-1" aria-hidden="true"><span><strong>${escapeHtml(offer.originalTitle)}</strong><small>${escapeHtml(offer.source)} - ${offer.isbn ? `ISBN ${escapeHtml(offer.isbn)}` : 'brak ISBN'}</small><small>${offer.bookId ? 'Automatyczne przypisanie wymaga potwierdzenia' : 'Brak przypisanego wydania'}</small></span><span class="review-price">${money(offer.currentPrice)}</span></button>`).join('') : '<div class="empty-detail"><h3>Brak pozycji</h3><p>Filtry nie zwracaja ofert wymagajacych decyzji.</p></div>';
  $$('[data-review-id]').forEach(button => button.addEventListener('click', () => { state.selectedReviewId = button.dataset.reviewId; renderReview(); })); renderReviewDetail();
}

function renderReviewDetail() {
  const offer = reviewOffers().find(row => row.id === state.selectedReviewId); if (!offer) return $('#reviewDetail').innerHTML = '<div class="empty-detail"><h3>Wybierz oferte</h3><p>Po lewej pojawia sie lista ofert wymagajacych decyzji.</p></div>';
  const options = (state.history.books || []).map(row => `<option value="${escapeHtml(row.book.id)}" ${offer.bookId === row.book.id ? 'selected' : ''}>${escapeHtml(row.book.title)}${row.book.isbn ? ` - ${escapeHtml(row.book.isbn)}` : ''}</option>`).join('');
  $('#reviewDetail').innerHTML = `<section class="detail-section"><div class="book-detail-title"><div><span class="status-pill warning">Do weryfikacji</span><h3>${escapeHtml(offer.originalTitle)}</h3></div><strong>${money(offer.currentPrice)}</strong></div><a href="${escapeHtml(offer.url)}" target="_blank" rel="noreferrer">Otworz oryginalne ogloszenie</a></section><section class="detail-section"><h4>Dane oferty</h4><div class="detail-grid"><span><b>Zrodlo</b><small>${escapeHtml(offer.source)}</small></span><span><b>ISBN</b><small>${escapeHtml(offer.isbn || 'Nie wykryto')}</small></span><span><b>Klasyfikacja ISBN</b><small>Brak w API historii</small></span><span><b>Ostatnio wykryto</b><small>${escapeHtml(date(offer.lastSeenAt))}</small></span></div></section><section class="detail-section"><h4>Decyzja</h4><p class="inline-note">Pelne dowody BN/OL i konflikty sa zapisane w SQLite, ale obecny backend nie udostepnia ich jeszcze do odczytu przez frontend.</p><select class="detail-select" id="reviewBookSelect"><option value="">Wybierz rekord katalogowy</option>${options}</select><div class="detail-actions"><button class="button primary" id="approveReview" type="button">Zatwierdz przypisanie</button><button class="button secondary" type="button" disabled>Oznacz jako nie-ksiazke</button><button class="button secondary" type="button" disabled>Odrzuc propozycje</button></div></section>`;
  $('#approveReview').disabled = !$('#reviewBookSelect').value;
  $('#reviewBookSelect').addEventListener('change', event => { $('#approveReview').disabled = !event.target.value; });
  $('#approveReview').addEventListener('click', approveReview);
}

async function approveReview() {
  const offerId = state.selectedReviewId, bookId = $('#reviewBookSelect').value; if (!offerId || !bookId) return;
  await json('/api/catalog/link', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({offerId, bookId})});
  const remaining = filteredReviewOffers().filter(row => row.id !== offerId); state.selectedReviewId = remaining[0]?.id || null; await loadHistory(); toast('Reczne przypisanie zostalo zapisane.');
}

function catalogRows() {
  const query = $('#catalogSearch').value.trim().toLocaleLowerCase('pl'), sort = $('#catalogSort').value;
  const rows = (state.history?.books || []).filter(row => !query || `${row.book.title} ${row.book.isbn || ''}`.toLocaleLowerCase('pl').includes(query));
  return rows.sort((a, b) => sort === 'offers' ? b.uniqueOffers - a.uniqueOffers : sort === 'recent' ? String(b.book.lastSeenAt).localeCompare(String(a.book.lastSeenAt)) : a.book.title.localeCompare(b.book.title, 'pl'));
}

function renderCatalog() {
  if (!state.history) return; const rows = catalogRows();
  $('#catalogList').innerHTML = rows.length ? rows.map(row => `<button class="catalog-row ${row.book.id === state.selectedCatalogId ? 'active' : ''}" type="button" data-catalog-id="${escapeHtml(row.book.id)}"><span><strong>${escapeHtml(row.book.title)}</strong><small>${row.book.isbn ? `ISBN ${escapeHtml(row.book.isbn)}` : 'Bez ISBN'}</small></span><span>1</span><span>${row.uniqueOffers}</span><span><span class="status-pill ${row.book.origin === 'manual' ? 'success' : 'warning'}">${row.book.origin === 'manual' ? 'Reczny' : 'Niezweryfikowany'}</span></span></button>`).join('') : '<div class="empty-detail"><h3>Katalog jest pusty</h3><p>Dodaj pierwszy rekord recznie.</p></div>';
  $$('[data-catalog-id]').forEach(button => button.addEventListener('click', () => openCatalogDetail(button.dataset.catalogId)));
}

async function openCatalogDetail(id) {
  state.selectedCatalogId = id; renderCatalog(); const detail = $('#catalogDetail'); detail.innerHTML = '<div class="empty-detail"><p>Wczytywanie rekordu...</p></div>';
  try { const row = await json(`/api/book?id=${encodeURIComponent(id)}`); detail.innerHTML = `<section class="detail-section"><div class="book-detail-title"><div><span class="status-pill ${row.book.origin === 'manual' ? 'success' : 'warning'}">${row.book.origin === 'manual' ? 'Reczny' : 'Niezweryfikowany'}</span><h3>${escapeHtml(row.book.title)}</h3><p>ISBN: ${escapeHtml(row.book.isbn || 'brak')}</p></div><strong>${row.currentOffers} ofert</strong></div></section><section class="detail-section"><h4>Podsumowanie cen</h4><div class="detail-grid"><span><b>Najtansza</b><small>${money(row.lowestCurrent)}</small></span><span><b>Mediana</b><small>${money(row.medianCurrent)}</small></span><span><b>Minimum historyczne</b><small>${money(row.historicalMinimum)}</small></span><span><b>Unikalne oferty</b><small>${row.uniqueOffers}</small></span></div></section><section class="detail-section"><h4>Powiazane oferty</h4><div class="price-list">${row.offers.map(offer => `<a href="${escapeHtml(offer.url)}" target="_blank" rel="noreferrer"><span>${escapeHtml(offer.originalTitle)}<small>${escapeHtml(offer.source)}</small></span><b>${money(offer.currentPrice)}</b></a>`).join('') || '<p>Brak ofert.</p>'}</div></section><section class="detail-section"><p class="inline-note">Lista wydan, identyfikatory BN/OL i pochodzenie metadanych wymagaja odczytowego endpointu katalogu SQLite.</p></section>`; }
  catch (error) { detail.innerHTML = `<div class="empty-detail"><h3>Nie udalo sie wczytac rekordu</h3><p>${escapeHtml(error.message)}</p></div>`; }
}

function filteredOffers() {
  const query = $('#offerSearch').value.trim().toLocaleLowerCase('pl'), source = $('#offerSource').value, status = $('#offerStatus').value, sort = $('#offerSort').value;
  const rows = allOffers().filter(offer => (!query || `${offer.originalTitle} ${offer.source} ${offer.isbn || ''}`.toLocaleLowerCase('pl').includes(query)) && (!source || offer.source === source) && (!status || (status === 'matched') === Boolean(offer.bookId)));
  return rows.sort((a, b) => sort === 'price-asc' ? a.currentPrice - b.currentPrice : sort === 'price-desc' ? b.currentPrice - a.currentPrice : sort === 'title' ? a.originalTitle.localeCompare(b.originalTitle, 'pl') : String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

function renderOffers() {
  if (!state.history) return; const rows = filteredOffers(), pages = Math.max(1, Math.ceil(rows.length / state.pageSize)); state.offerPage = Math.min(state.offerPage, pages); const start = (state.offerPage - 1) * state.pageSize, pageRows = rows.slice(start, start + state.pageSize);
  $('#offerTotal').textContent = `${rows.length} ofert`; $('#offersTableBody').innerHTML = pageRows.length ? pageRows.map(offer => { const book = bookFor(offer.bookId); return `<tr><td><button class="link-button offer-title" type="button" data-offer-id="${escapeHtml(offer.id)}">${escapeHtml(offer.originalTitle)}</button><span class="offer-subtitle">${escapeHtml(offer.matchedQueries?.join(', ') || '')}</span></td><td>${escapeHtml(offer.source)}</td><td>${money(offer.currentPrice)}</td><td>${escapeHtml(offer.isbn || '-')}</td><td>${escapeHtml(book?.title || '-')}</td><td><span class="status-pill ${offer.linkMode === 'manual' ? 'success' : offer.bookId ? 'warning' : 'neutral'}">${offer.linkMode === 'manual' ? 'Reczne' : offer.bookId ? 'Automatyczne' : 'Nieprzypisana'}</span></td><td>${escapeHtml(date(offer.lastSeenAt))}</td></tr>`; }).join('') : '<tr><td colspan="7" class="empty-cell">Brak ofert zgodnych z filtrami.</td></tr>';
  $('#offerPageLabel').textContent = `Strona ${state.offerPage} z ${pages}`; $('#offerPrev').disabled = state.offerPage <= 1; $('#offerNext').disabled = state.offerPage >= pages;
  $$('[data-offer-id]').forEach(button => button.addEventListener('click', () => openOfferDrawer(button.dataset.offerId)));
}

function openOfferDrawer(id) {
  const offer = allOffers().find(row => row.id === id); if (!offer) return; const book = bookFor(offer.bookId); $('#offerDrawer').hidden = false;
  $('#offerDrawerContent').innerHTML = `<span class="status-pill ${offer.bookId ? 'warning' : 'neutral'}">${offer.bookId ? 'Przypisana' : 'Do weryfikacji'}</span><h2>${escapeHtml(offer.originalTitle)}</h2><div class="detail-grid"><span><b>Cena</b><small>${money(offer.currentPrice)}</small></span><span><b>Zrodlo</b><small>${escapeHtml(offer.source)}</small></span><span><b>ISBN</b><small>${escapeHtml(offer.isbn || 'brak')}</small></span><span><b>Ostatnio</b><small>${escapeHtml(date(offer.lastSeenAt))}</small></span><span><b>Wykrycia</b><small>${offer.seenCount || 0}</small></span><span><b>Wydanie</b><small>${escapeHtml(book?.title || 'nieprzypisane')}</small></span></div><div class="detail-actions"><a class="button primary" href="${escapeHtml(offer.url)}" target="_blank" rel="noreferrer">Otworz ogloszenie</a>${offer.linkMode !== 'manual' ? '<button class="button secondary" type="button" id="drawerReview">Przejdz do weryfikacji</button>' : ''}</div><p class="inline-note">Pelna historia cen pojedynczej oferty wymaga osobnego endpointu. Dane historyczne pozostaja zachowane w magazynie.</p>`;
  $('#drawerReview')?.addEventListener('click', () => { state.selectedReviewId = id; $('#offerDrawer').hidden = true; showView('review'); });
}

function renderSettings() { if (!state.catalog) loadCatalogStatus(); }
async function runDiagnostics() {
  const button = $('#runDiagnostics'); button.disabled = true; $('#diagnosticResults').innerHTML = '<div class="diagnostic-result"><strong>Trwa test...</strong><small>Lokalne endpointy</small></div>';
  const checks = [['Zrodla', '/api/sources'], ['Historia JSON', '/api/history'], ['Katalog SQLite', '/api/catalog/status']];
  const results = await Promise.all(checks.map(async ([name, url]) => { const started = performance.now(); try { const response = await fetch(url); return {name, ok: response.ok, ms: Math.round(performance.now() - started), code: response.status}; } catch { return {name, ok: false, ms: Math.round(performance.now() - started), code: 'ERR'}; } }));
  $('#diagnosticResults').innerHTML = results.map(result => `<div class="diagnostic-result"><strong>${escapeHtml(result.name)} - ${result.ok ? 'OK' : 'BLAD'}</strong><small>${result.code} / ${result.ms} ms</small></div>`).join(''); button.disabled = false;
}

function setCatalogMode(mode) {
  $$('[data-catalog-mode]').forEach(button => button.classList.toggle('active', button.dataset.catalogMode === mode)); $('#catalogIsbnMode').hidden = mode !== 'isbn'; $('#catalogManualMode').hidden = mode !== 'manual';
  $('#catalogSubmit').disabled = mode === 'isbn'; $('#catalogFormMessage').hidden = mode !== 'isbn'; $('#catalogFormMessage').textContent = mode === 'isbn' ? 'Podglad metadanych BN/OL nie ma jeszcze endpointu frontendowego. Ten tryb pozostaje bezpiecznie nieaktywny.' : '';
}

async function submitCatalog(event) {
  event.preventDefault(); const title = $('#catalogTitle').value.trim(), isbn = $('#catalogManualIsbn').value.trim(); if (!title) return toast('Podaj tytul dziela.');
  const data = await json('/api/catalog', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title, isbn})}); state.history = data.catalog; $('#catalogDialog').close(); event.target.reset(); await loadHistory(); renderCatalog(); toast('Reczny rekord katalogowy zostal zapisany.');
}

$$('.nav-item').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('#refreshView').addEventListener('click', () => Promise.all([loadHistory(), loadCatalogStatus()]).then(() => toast('Dane odswiezone.')));
$('#toggleSources').addEventListener('click', () => { const boxes = $$('#sourceGrid input'); const all = boxes.length && boxes.every(box => box.checked); boxes.forEach(box => { box.checked = !all; }); });
$('#startSearch').addEventListener('click', startSearch); $('#goToOffers').addEventListener('click', () => showView('offers'));
for (const selector of ['#reviewSearch', '#reviewSource', '#reviewIsbn', '#reviewSort']) $(selector).addEventListener(selector === '#reviewSearch' ? 'input' : 'change', renderReview);
for (const selector of ['#catalogSearch', '#catalogSort']) $(selector).addEventListener(selector === '#catalogSearch' ? 'input' : 'change', renderCatalog);
for (const selector of ['#offerSearch', '#offerSource', '#offerStatus', '#offerSort']) $(selector).addEventListener(selector === '#offerSearch' ? 'input' : 'change', () => { state.offerPage = 1; renderOffers(); });
$('#offerPrev').addEventListener('click', () => { state.offerPage -= 1; renderOffers(); }); $('#offerNext').addEventListener('click', () => { state.offerPage += 1; renderOffers(); }); $('#closeOfferDrawer').addEventListener('click', () => { $('#offerDrawer').hidden = true; });
$('#openCatalogForm').addEventListener('click', () => { $('#catalogDialog').showModal(); setCatalogMode('manual'); }); $('#closeCatalogForm').addEventListener('click', () => $('#catalogDialog').close()); $('#cancelCatalogForm').addEventListener('click', () => $('#catalogDialog').close());
$$('[data-catalog-mode]').forEach(button => button.addEventListener('click', () => setCatalogMode(button.dataset.catalogMode))); $('#catalogForm').addEventListener('submit', submitCatalog); $('#runDiagnostics').addEventListener('click', runDiagnostics);

showView(new URLSearchParams(location.search).get('view') || 'scanner');
Promise.all([loadSources(), loadHistory(), loadCatalogStatus()]).catch(error => { $('#connectionLabel').textContent = 'Blad polaczenia'; toast(`Nie udalo sie wczytac aplikacji: ${error.message}`); });
