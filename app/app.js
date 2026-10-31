const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
  activeView: 'scanner', sources: [], history: null, catalog: null,
  catalogWorks: [], reviewJobs: [], sqliteOffers: [], reviewDetail: null, catalogMode: 'manual', catalogPreview: null,
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
function allOffers() { return state.catalog?.enabled === false ? (state.history?.offers || []) : state.sqliteOffers; }
function reviewOffers() { return state.reviewJobs; }
function renderScannerOffers() {
  const mount = $('#scannerOfferList');
  if (!mount) return;
  const all = [...allOffers()];
  const sourceSelect = $('#scannerOfferSource');
  const activeSource = sourceSelect.value;
  const sources = [...new Set(all.map(item => item.source).filter(Boolean))].sort((a,b) => a.localeCompare(b,'pl'));
  sourceSelect.innerHTML = '<option value="">Wszystkie źródła</option>' + sources.map(source => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join('');
  sourceSelect.value = sources.includes(activeSource) ? activeSource : '';
  const needle = $('#scannerOfferSearch').value.trim().toLocaleLowerCase('pl');
  const filtered = all.filter(item =>
    (!sourceSelect.value || item.source === sourceSelect.value) &&
    (!needle || `${item.title || item.originalTitle || ''} ${item.source || ''} ${item.observedIsbn || item.isbn || ''}`.toLocaleLowerCase('pl').includes(needle))
  ).sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
  const offers = filtered.slice(0, 12);
  $('#scannerOfferCount').textContent = `Pokazano ${offers.length} z ${filtered.length} pasujących ofert`;
  $('#scannerDiscoverSummary').textContent = state.catalog?.enabled === false
    ? 'Oferty z lokalnego JSON. Nie są to wyniki bieżącego skanu.'
    : 'Ostatnio zapisane oferty SQLite. Nie są to wyniki bieżącego skanu.';
  mount.innerHTML = offers.length ? offers.map(item => {
    const title = item.title || item.originalTitle || 'Tytuł nieznany';
    const isbn = item.observedIsbn || item.isbn || 'ISBN nieznany';
    return `<button class="scanner-offer-row" type="button" data-scanner-offer-id="${escapeHtml(item.id)}"><span class="book-spine" aria-hidden="true">▤</span><span class="scanner-offer-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(item.source)} · ${escapeHtml(isbn)}</small><small>${escapeHtml(date(item.lastSeenAt))}</small></span><span class="scanner-offer-price">${money(item.currentPrice)}</span></button>`;
  }).join('') : '<div class="empty-detail"><p>Brak ofert zgodnych z filtrami albo baza jest pusta.</p></div>';
  mount.querySelectorAll('[data-scanner-offer-id]').forEach(button => button.addEventListener('click', () => openOfferDrawer(button.dataset.scannerOfferId)));
}



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
  if (name === 'scanner') renderScannerOffers();
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
  renderReview(); renderCatalog(); renderOffers(); renderScannerOffers();
}

// API pages are limited to 250 rows. Read subsequent pages rather than silently
// hiding catalog records after the first page. A larger dataset needs server-side UX.
async function loadCatalogPages(endpoint, maxPages = 40) {
  const limit = 250;
  const items = [];
  let expected = null;
  for (let page = 0; page < maxPages; page++) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const data = await json(`${endpoint}${separator}limit=${limit}&offset=${page * limit}`);
    if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0) throw Error('INVALID_CATALOG_PAGE');
    if (expected === null) expected = data.total;
    if (data.total !== expected) throw Error('CATALOG_CHANGED_DURING_PAGINATION');
    items.push(...data.items);
    if (items.length >= expected) return { items, total: expected };
    if (data.items.length === 0) throw Error('INCOMPLETE_CATALOG_PAGE');
  }
  throw Error('CATALOG_PAGE_LIMIT_EXCEEDED');
}

async function loadCatalogData() {
  try {
    const [works, jobs, offers] = await Promise.all([
      loadCatalogPages('/api/catalog/works'),
      loadCatalogPages('/api/identification-jobs'),
      loadCatalogPages('/api/offers'),
    ]);
    state.catalogWorks = works.items; state.reviewJobs = jobs.items; state.sqliteOffers = offers.items;
    $('#offersNavCount').textContent = `${offers.total} zapisanych`;
    $('#reviewNavCount').textContent = `${jobs.total} pozycji`;
    renderReview(); renderCatalog(); renderOffers(); renderScannerOffers();
  } catch (error) {
    // Preserve the previous successful snapshot. Never silently replace
    // an unavailable SQLite catalog with unrelated JSON history.
    $('#databaseStatus').textContent = 'SQLite: błąd odczytu katalogu';
    toast(`Nie udało się wczytać katalogu SQLite: ${error.message}`);
  }
}

async function loadCatalogStatus() {
  try {
    state.catalog = await json('/api/catalog/status'); const counts = state.catalog.counts || {};
    $('#databaseStatus').textContent = `SQLite: ${counts.works || 0} dziel / ${counts.editions || 0} wydan`;
    $('#catalogWorks').textContent = counts.works || 0; $('#catalogEditions').textContent = counts.editions || 0;
    $('#catalogIncomplete').textContent = counts.identification_pending ?? counts.identification_jobs ?? 0;
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
    await Promise.all([loadHistory(), loadCatalogStatus(), loadCatalogData()]); renderSourceRows(); toast(`Skan zakonczony: ${summary.offers || 0} ofert.`);
  } catch (error) {
    $('#progressMessage').textContent = 'Skan przerwany'; $('#progressDetail').textContent = error.message; $('#scanStateBadge').textContent = 'Blad'; $('#scanStateBadge').className = 'state-badge warning'; toast(`Nie udalo sie wykonac skanu: ${error.message}`);
  } finally {
    clearInterval(state.scan.timer); state.scan.running = false; $('#startSearch').disabled = false; $('#startSearch').textContent = 'Uruchom skan'; $('#scanGuardMessage').textContent = '';
  }
}

function filteredReviewOffers() {
  const query = $('#reviewSearch').value.trim().toLocaleLowerCase('pl'), source = $('#reviewSource').value, isbn = $('#reviewIsbn').value;
  const rows = reviewOffers().filter(job => { const offer = job.offer; return (!query || `${offer.title} ${offer.source} ${offer.observedIsbn || ''}`.toLocaleLowerCase('pl').includes(query)) && (!source || offer.source === source) && (!isbn || (isbn === 'present') === Boolean(offer.observedIsbn)); });
  return rows.sort((a, b) => $('#reviewSort').value === 'price' ? a.offer.currentPrice - b.offer.currentPrice : String(b.offer.lastSeenAt).localeCompare(String(a.offer.lastSeenAt)));
}

function renderReview() {
  if (!state.history) return; const rows = filteredReviewOffers();
  $('#reviewCount').textContent = `${rows.length} oczekujacych`; $('#reviewNavCount').textContent = `${reviewOffers().length} pozycji`;
  if (state.selectedReviewId && !rows.some(row => row.id === state.selectedReviewId)) state.selectedReviewId = null;
  $('#reviewList').innerHTML = rows.length ? rows.map(job => { const offer = job.offer; return `<button class="review-item ${job.id === state.selectedReviewId ? 'active' : ''}" type="button" data-review-id="${escapeHtml(job.id)}"><span class="book-spine" aria-hidden="true">▤</span><span><strong>${escapeHtml(offer.title)}</strong><small>${escapeHtml(offer.source)} - ${offer.observedIsbn ? `ISBN ${escapeHtml(offer.observedIsbn)}` : 'brak ISBN'}</small><small>${escapeHtml(job.status)}${job.lastError ? ` - ${escapeHtml(job.lastError)}` : ''}</small></span><span class="review-price">${money(offer.currentPrice)}</span></button>`; }).join('') : '<div class="empty-detail"><h3>Brak pozycji</h3><p>Filtry nie zwracaja ofert wymagajacych decyzji.</p></div>';
  $$('[data-review-id]').forEach(button => button.addEventListener('click', async () => { state.selectedReviewId = button.dataset.reviewId; state.reviewDetail = null; renderReview(); const job = state.reviewJobs.find(row => row.id === state.selectedReviewId); if (job) { try { state.reviewDetail = await json(`/api/offers/${encodeURIComponent(job.offerId)}`); renderReviewDetail(); } catch (error) { toast(error.message); } } })); renderReviewDetail();
}

function normalizedIsbn(value) { return String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase(); }
function reviewCandidateMarkup(offer, suggested) {
  if (!suggested) return '<p class="inline-note">Brak propozycji w załadowanym katalogu. Wyszukaj ręcznie wydanie poniżej.</p>';
  const {work,edition}=suggested;
  const observed=normalizedIsbn(offer.observedIsbn);
  const identifiers=(edition.identifiers||[]).filter(item=>String(item.scheme).startsWith('isbn')).map(item=>normalizedIsbn(item.value));
  const conflict=Boolean(observed && identifiers.length && !identifiers.includes(observed));
  const fact=!observed?'Brak ISBN w ogłoszeniu':!identifiers.length?'Brak ISBN w katalogowym wydaniu':conflict?'RÓŻNE ISBN — sprawdź wydanie':'Zgodny ISBN';
  return `<div class="comparison-candidate"><span class="book-spine" aria-hidden="true">▤</span><span class="candidate-body"><b>${escapeHtml(work.title)}</b><small>${escapeHtml(work.authors.join(', ')||'Autor nieznany')}</small><small>Wydanie: ${escapeHtml(edition.title)}</small><small>Wydawca: ${escapeHtml(edition.publisher||'nieznany')} · Rok: ${escapeHtml(edition.publicationYear||'nieznany')}</small><small>ISBN wydania: ${escapeHtml(identifiers.join(', ')||'brak')}</small></span></div><div class="verification-fact ${conflict?'verification-conflict':observed&&identifiers.includes(observed)?'verification-match':'verification-unknown'}"><strong>Porównanie ISBN:</strong> ${escapeHtml(fact)}</div>`;
}

function renderReviewDetail() {
  const job = reviewOffers().find(row => row.id === state.selectedReviewId); if (!job) return $('#reviewDetail').innerHTML = '<div class="empty-detail"><h3>Wybierz oferte</h3><p>Po lewej pojawia sie lista ofert wymagajacych decyzji.</p></div>';
  const offer = state.reviewDetail || job.offer, evidence = state.reviewDetail?.evidence || [], result = job.result || {};
  const suggested = result.editionId ? state.catalogWorks.flatMap(w=>w.editions.map(e=>({work:w,edition:e}))).find(x=>x.edition.id===result.editionId) : null;
  const candidate = reviewCandidateMarkup(offer, suggested);

  $('#reviewDetail').innerHTML = `<section class="detail-section"><div class="book-detail-title"><div><span class="status-pill warning">${escapeHtml(job.status)}</span><h3>${escapeHtml(offer.title)}</h3></div><strong>${money(offer.currentPrice)}</strong></div><a href="${escapeHtml(offer.url)}" target="_blank" rel="noreferrer">Otworz oryginalne ogloszenie</a></section><section class="detail-section"><h4>Dane oferty i dowody</h4><div class="detail-grid"><span><b>Zrodlo</b><small>${escapeHtml(offer.source)}</small></span><span><b>ISBN</b><small>${escapeHtml(offer.observedIsbn || 'Nie wykryto')}</small></span><span><b>Klasyfikacja ISBN</b><small>${escapeHtml(evidence.map(row => row.classification).join(', ') || 'brak dowodu')}</small></span><span><b>Ostatnio wykryto</b><small>${escapeHtml(date(offer.lastSeenAt))}</small></span></div><p class="inline-note">${escapeHtml(result.reason?.join?.(', ') || job.lastError || 'Wybierz właściwe wydanie albo oznacz ofertę jako nie-książkę.')}</p></section><section class="detail-section review-comparison"><h4>Proponowane wydanie</h4><p class="inline-note">Sprawdź porównanie przed zatwierdzeniem. Automatyczna propozycja nie jest ostateczną decyzją.</p>${candidate}</section><section class="detail-section"><h4>Decyzja</h4><div class="book-combobox"><input class="detail-select" id="reviewBookSearch" type="search" role="combobox" aria-controls="reviewBookOptions" aria-expanded="true" autocomplete="off" placeholder="Wpisz tytul, autora lub ISBN" data-edition-id=""><div class="book-options" id="reviewBookOptions" role="listbox"></div></div><div class="detail-actions"><button class="button primary" id="approveReview" type="button" disabled>Zatwierdz przypisanie</button>${result.editionId ? '<button class="button secondary" id="rejectProposal" type="button">Odrzuć propozycję</button>' : ''}<button class="button secondary" id="markNotBook" type="button">Oznacz jako nie-ksiazke</button><button class="button secondary" id="requeueReview" type="button">Ponow identyfikacje</button></div></section>`;
  $('#approveReview').disabled = !$('#reviewBookSearch').dataset.editionId;
  $('#reviewBookSearch').addEventListener('input', event => { event.target.dataset.editionId = ''; $('#approveReview').disabled = true; renderReviewBookChoices(event.target.value); });
  $('#reviewBookSearch').addEventListener('focus', event => renderReviewBookChoices(event.target.value));
  renderReviewBookChoices('');
  if (suggested) {
    const input = $('#reviewBookSearch');
    input.value = suggested.work.title;
    input.dataset.editionId = suggested.edition.id;
    input.setAttribute('aria-expanded', 'false');
    $('#reviewBookOptions').innerHTML = '';
    const proposedIsbn = normalizedIsbn(offer.observedIsbn);
    const editionIsbns = suggested.edition.identifiers.filter(item => String(item.scheme).startsWith('isbn')).map(item => normalizedIsbn(item.value));
    $('#approveReview').disabled = Boolean(proposedIsbn && editionIsbns.length && !editionIsbns.includes(proposedIsbn));
    if ($('#approveReview').disabled) { input.dataset.editionId = ''; input.value = ''; input.placeholder = 'Konflikt ISBN — wybierz wydanie ręcznie'; }
  }
  $('#approveReview').addEventListener('click', approveReview);
  $('#markNotBook').addEventListener('click', () => decideReview('not_book'));
  $('#requeueReview').addEventListener('click', () => decideReview('requeued'));
  $('#rejectProposal')?.addEventListener('click', () => decideReview('proposal_rejected', result.editionId));
}

function renderReviewBookChoices(query = '') {
  const list = $('#reviewBookOptions'), input = $('#reviewBookSearch'); if (!list || !input) return;
  const needle = query.trim().toLocaleLowerCase('pl');
  const editions = state.catalogWorks.flatMap(work => work.editions.map(edition => ({ work, edition }))).filter(({work, edition}) => !needle || `${work.title} ${work.authors.join(' ')} ${edition.identifiers.map(row => row.value).join(' ')}`.toLocaleLowerCase('pl').includes(needle)).slice(0, 30);
  list.innerHTML = editions.length ? editions.map(({work, edition}) => `<button type="button" role="option" data-review-edition-id="${escapeHtml(edition.id)}" data-review-book-title="${escapeHtml(work.title)}"><strong>${escapeHtml(work.title)}</strong><small>${escapeHtml(edition.identifiers.find(row => row.scheme.startsWith('isbn'))?.value || 'Bez ISBN')} - ${escapeHtml(edition.publisher || 'wydawca nieznany')}</small></button>`).join('') : '<p>Brak rekordow pasujacych do wpisanej frazy.</p>';
  $$('[data-review-edition-id]').forEach(button => button.addEventListener('click', () => { input.value = button.dataset.reviewBookTitle; input.dataset.editionId = button.dataset.reviewEditionId; input.setAttribute('aria-expanded', 'false'); list.innerHTML = ''; $('#approveReview').disabled = false; input.focus(); }));
}

async function approveReview() {
  const editionId = $('#reviewBookSearch').dataset.editionId; if (!editionId) return;
  await decideReview('approved', editionId);
}

async function decideReview(action, editionId = null) {
  const jobId = state.selectedReviewId; if (!jobId) return;
  await json(`/api/identification-jobs/${encodeURIComponent(jobId)}/decision`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action, editionId})});
  state.selectedReviewId = null; state.reviewDetail = null; await loadCatalogData(); toast('Decyzja została zapisana w historii SQLite.');
}

function catalogRows() {
  const query = $('#catalogSearch').value.trim().toLocaleLowerCase('pl'), sort = $('#catalogSort').value;
  const rows = state.catalogWorks.filter(row => !query || `${row.title} ${row.authors.join(' ')} ${row.editions.flatMap(edition => edition.identifiers.map(item => item.value)).join(' ')}`.toLocaleLowerCase('pl').includes(query));
  return rows.sort((a, b) => sort === 'offers' ? b.offerCount - a.offerCount : a.title.localeCompare(b.title, 'pl'));
}

function renderCatalog() {
  if (!state.history) return; const rows = catalogRows();
  $('#catalogList').innerHTML = rows.length ? rows.map(row => `<button class="catalog-row ${row.id === state.selectedCatalogId ? 'active' : ''}" type="button" data-catalog-id="${escapeHtml(row.id)}"><span class="catalog-book-title"><span class="book-spine" aria-hidden="true">▤</span><span class="catalog-book-copy"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.authors.join(', ') || 'Autor nieznany')}</small><small class="catalog-isbn">${escapeHtml(row.editions.flatMap(e => e.identifiers.filter(v => v.scheme.startsWith("isbn")).map(v => v.value))[0] || "ISBN nieznany")}</small></span></span><span>${row.editionCount}</span><span>${row.offerCount}</span><span><span class="status-pill ${['manual','verified'].includes(row.verificationStatus) ? 'success' : 'warning'}">${escapeHtml(row.verificationStatus)}</span></span></button>`).join('') : '<div class="empty-detail"><h3>Katalog jest pusty</h3><p>Zaimportuj dane historyczne albo dodaj rekord.</p></div>';
  $$('[data-catalog-id]').forEach(button => button.addEventListener('click', () => openCatalogDetail(button.dataset.catalogId)));
}

async function openCatalogDetail(id) {
  state.selectedCatalogId = id; renderCatalog(); const detail = $('#catalogDetail'); detail.innerHTML = '<div class="empty-detail"><p>Wczytywanie rekordu...</p></div>';
  try { const row = await json(`/api/catalog/works/${encodeURIComponent(id)}`); detail.innerHTML = `<section class="detail-section"><div class="book-detail-title"><div><span class="status-pill ${['manual','verified'].includes(row.verificationStatus) ? 'success' : 'warning'}">${escapeHtml(row.verificationStatus)}</span><h3>${escapeHtml(row.title)}</h3><p>${escapeHtml(row.authors.join(', ') || 'Autor nieznany')}</p></div><strong>${row.editions.length} wydań</strong></div></section><section class="detail-section"><h4>Wydania</h4><div class="price-list">${row.editions.map(edition => `<button type="button" class="link-button" data-edition-detail="${escapeHtml(edition.id)}"><span><strong>${escapeHtml(edition.title)}</strong><small>${escapeHtml([edition.publisher, edition.publicationYear, edition.language].filter(Boolean).join(' / ') || 'Brak szczegółów')}</small></span><b>${escapeHtml(edition.identifiers.find(item => item.scheme.startsWith('isbn'))?.value || 'bez ISBN')}</b></button>`).join('') || '<p>Brak wydań.</p>'}</div></section><section class="detail-section"><h4>Pochodzenie</h4><p class="inline-note">${row.externalRecords.length ? row.externalRecords.map(record => `${record.provider}: ${record.externalId}`).join(', ') : 'Brak zewnętrznych rekordów bibliograficznych.'}</p></section>`; $$('[data-edition-detail]').forEach(button => button.addEventListener('click', () => openEditionDetail(button.dataset.editionDetail))); }
  catch (error) { detail.innerHTML = `<div class="empty-detail"><h3>Nie udalo sie wczytac rekordu</h3><p>${escapeHtml(error.message)}</p></div>`; }
}

async function openEditionDetail(id) {
  const detail = $('#catalogDetail'); detail.innerHTML = '<div class="empty-detail"><p>Wczytywanie wydania...</p></div>';
  try { const row = await json(`/api/catalog/editions/${encodeURIComponent(id)}`); detail.innerHTML = `<section class="detail-section"><button class="link-button" id="backToWork" type="button">← Wróć do dzieła</button><h3>${escapeHtml(row.title)}</h3><div class="detail-grid"><span><b>ISBN</b><small>${escapeHtml(row.identifiers.filter(item => item.scheme.startsWith('isbn')).map(item => item.value).join(', ') || 'brak')}</small></span><span><b>Wydawca</b><small>${escapeHtml(row.publisher || '-')}</small></span><span><b>Rok</b><small>${escapeHtml(row.publicationYear || '-')}</small></span><span><b>Język / oprawa</b><small>${escapeHtml([row.language,row.binding].filter(Boolean).join(' / ') || '-')}</small></span></div></section><section class="detail-section"><h4>Powiązane oferty</h4><div class="price-list">${row.offers.map(item => `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer"><span>${escapeHtml(item.title)}<small>${escapeHtml(item.source)}</small></span><b>${money(item.currentPrice)}</b></a>`).join('') || '<p>Brak ofert.</p>'}</div></section>`; $('#backToWork').addEventListener('click', () => openCatalogDetail(row.workId)); } catch (error) { detail.innerHTML = `<div class="empty-detail"><p>${escapeHtml(error.message)}</p></div>`; }
}

function filteredOffers() {
  const query = $('#offerSearch').value.trim().toLocaleLowerCase('pl'), source = $('#offerSource').value, status = $('#offerStatus').value, sort = $('#offerSort').value;
  const rows = allOffers().filter(offer => (!query || `${offer.title || offer.originalTitle} ${offer.source} ${offer.observedIsbn || offer.isbn || ''}`.toLocaleLowerCase('pl').includes(query)) && (!source || offer.source === source) && (!status || (status === 'matched') === Boolean(offer.match || offer.bookId)));
  return rows.sort((a, b) => sort === 'price-asc' ? a.currentPrice - b.currentPrice : sort === 'price-desc' ? b.currentPrice - a.currentPrice : sort === 'title' ? (a.title || a.originalTitle).localeCompare(b.title || b.originalTitle, 'pl') : String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

function renderOffers() {
  if (!state.history) return; const rows = filteredOffers(), pages = Math.max(1, Math.ceil(rows.length / state.pageSize)); state.offerPage = Math.min(state.offerPage, pages); const start = (state.offerPage - 1) * state.pageSize, pageRows = rows.slice(start, start + state.pageSize);
  $('#offerTotal').textContent = `${rows.length} ofert`;
  const mobile = $('#offersMobileList');
  if (mobile) {
    mobile.innerHTML = pageRows.map(item => {
      const match = item.match || (item.bookId ? {workTitle: bookFor(item.bookId)?.title, method: item.linkMode} : null);
      return `<button class="mobile-offer" data-mobile-offer-id="${escapeHtml(item.id)}" type="button"><span class="book-spine" aria-hidden="true">▤</span><span class="mobile-offer-copy"><strong>${escapeHtml(item.title || item.originalTitle)}</strong><small>${escapeHtml(item.source)} · ${escapeHtml(item.observedIsbn || item.isbn || 'ISBN nieznany')}</small><small class="mobile-offer-match">${escapeHtml(match?.workTitle || match?.editionTitle || 'Nieprzypisana do wydania')}</small></span><span class="mobile-offer-price"><b>${money(item.currentPrice)}</b><small>${escapeHtml(match?.method === 'manual' ? 'Ręczne' : match ? 'Dopasowane' : 'Do sprawdzenia')}</small></span></button>`;
    }).join('') || '<div class="empty-detail">Brak ofert zgodnych z filtrami.</div>';
    mobile.querySelectorAll('[data-mobile-offer-id]').forEach(b=>b.addEventListener('click',()=>openOfferDrawer(b.dataset.mobileOfferId)));
  }
  $('#offersTableBody').innerHTML = pageRows.length ? pageRows.map(offer => { const matched = offer.match || (offer.bookId ? {workTitle: bookFor(offer.bookId)?.title, method: offer.linkMode} : null); return `<tr><td><button class="link-button offer-title" type="button" data-offer-id="${escapeHtml(offer.id)}">${escapeHtml(offer.title || offer.originalTitle)}</button><span class="offer-subtitle">${escapeHtml(offer.matchedQueries?.join(', ') || '')}</span></td><td>${escapeHtml(offer.source)}</td><td>${money(offer.currentPrice)}</td><td>${escapeHtml(offer.observedIsbn || offer.isbn || '-')}</td><td>${escapeHtml(matched?.workTitle || matched?.editionTitle || '-')}</td><td><span class="status-pill ${matched?.method === 'manual' ? 'success' : matched ? 'warning' : 'neutral'}">${matched?.method === 'manual' ? 'Ręczne' : matched ? 'Automatyczne' : escapeHtml(offer.identification?.status || 'Nieprzypisana')}</span></td><td>${escapeHtml(date(offer.lastSeenAt))}</td></tr>`; }).join('') : '<tr><td colspan="7" class="empty-cell">Brak ofert zgodnych z filtrami.</td></tr>';
  $('#offerPageLabel').textContent = `Strona ${state.offerPage} z ${pages}`; $('#offerPrev').disabled = state.offerPage <= 1; $('#offerNext').disabled = state.offerPage >= pages;
  $$('[data-offer-id]').forEach(button => button.addEventListener('click', () => openOfferDrawer(button.dataset.offerId)));
}

async function openOfferDrawer(id) {
  $('#offerDrawer').hidden = false; $('#offerDrawerContent').innerHTML = '<p>Wczytywanie szczegółów...</p>';
  try { const offer = await json(`/api/offers/${encodeURIComponent(id)}`), active = offer.matches.find(item => item.status === 'active');
    $('#offerDrawerContent').innerHTML = `<span class="status-pill ${active ? 'success' : 'neutral'}">${active ? 'Przypisana' : escapeHtml(offer.identificationJob?.status || 'Bez przypisania')}</span><h2>${escapeHtml(offer.title)}</h2><div class="detail-grid"><span><b>Cena</b><small>${money(offer.currentPrice)}</small></span><span><b>Zrodlo</b><small>${escapeHtml(offer.source)}</small></span><span><b>ISBN</b><small>${escapeHtml(offer.observedIsbn || 'brak')}</small></span><span><b>Ostatnio</b><small>${escapeHtml(date(offer.lastSeenAt))}</small></span><span><b>Wykrycia</b><small>${offer.seenCount || 0}</small></span><span><b>Wydanie</b><small>${escapeHtml(active?.editionTitle || 'nieprzypisane')}</small></span></div><section class="detail-section"><h4>Historia cen</h4><div class="price-list">${offer.priceHistory.map(item => `<span><small>${escapeHtml(date(item.observedAt))}</small><b>${money(item.price)}</b></span>`).join('') || '<p>Brak obserwacji.</p>'}</div></section><div class="detail-actions"><a class="button primary" href="${escapeHtml(offer.url)}" target="_blank" rel="noreferrer">Otworz ogloszenie</a>${offer.identificationJob && offer.identificationJob.status !== 'completed' ? '<button class="button secondary" type="button" id="drawerReview">Przejdz do weryfikacji</button>' : ''}</div>`;
    $('#drawerReview')?.addEventListener('click', () => { state.selectedReviewId = offer.identificationJob.id; state.reviewDetail = offer; $('#offerDrawer').hidden = true; showView('review'); });
  } catch (error) { $('#offerDrawerContent').innerHTML = `<p>${escapeHtml(error.message)}</p>`; }
}

function renderSettings() { if (!state.catalog) loadCatalogStatus(); }
async function runDiagnostics() {
  const button = $('#runDiagnostics'); button.disabled = true; $('#diagnosticResults').innerHTML = '<div class="diagnostic-result"><strong>Trwa test...</strong><small>Lokalne endpointy</small></div>';
  const checks = [['Zrodla', '/api/sources'], ['Historia JSON', '/api/history'], ['Katalog SQLite', '/api/catalog/status']];
  const results = await Promise.all(checks.map(async ([name, url]) => { const started = performance.now(); try { const response = await fetch(url); return {name, ok: response.ok, ms: Math.round(performance.now() - started), code: response.status}; } catch { return {name, ok: false, ms: Math.round(performance.now() - started), code: 'ERR'}; } }));
  $('#diagnosticResults').innerHTML = results.map(result => `<div class="diagnostic-result"><strong>${escapeHtml(result.name)} - ${result.ok ? 'OK' : 'BLAD'}</strong><small>${result.code} / ${result.ms} ms</small></div>`).join(''); button.disabled = false;
}

function setCatalogMode(mode) {
  state.catalogMode = mode; state.catalogPreview = null;
  $$('[data-catalog-mode]').forEach(button => button.classList.toggle('active', button.dataset.catalogMode === mode)); $('#catalogIsbnMode').hidden = mode !== 'isbn'; $('#catalogManualMode').hidden = mode !== 'manual';
  $('#catalogSubmit').disabled = false; $('#catalogSubmit').textContent = mode === 'isbn' ? 'Sprawdź ISBN' : 'Zapisz rekord'; $('#catalogFormMessage').hidden = true; $('#catalogFormMessage').textContent = '';
}

async function submitCatalog(event) {
  event.preventDefault();
  if (state.catalogMode === 'isbn') {
    const isbn = $('#catalogIsbn').value.trim(); if (!isbn) return toast('Podaj ISBN.');
    $('#catalogSubmit').disabled = true; $('#catalogFormMessage').hidden = false; $('#catalogFormMessage').textContent = 'Sprawdzanie katalogu lokalnego oraz metadanych BN/OL...';
    try {
      if (!state.catalogPreview) {
        state.catalogPreview = await json('/api/catalog/lookup-preview', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({isbn})});
        const records = [state.catalogPreview.bn, state.catalogPreview.openLibrary].flatMap(result => result?.records || []);
        $('#catalogFormMessage').textContent = records.length ? `${state.catalogPreview.comparison.status}: ${records.map(record => `${record.source} — ${record.title || 'bez tytułu'}`).join(' | ')}. Kliknij ponownie, aby zatwierdzić utworzenie rekordu.` : 'Nie znaleziono jednoznacznego rekordu. Nic nie zapisano.';
        $('#catalogSubmit').textContent = records.length ? 'Zatwierdź rekord' : 'Sprawdź ponownie'; $('#catalogSubmit').disabled = !records.length; return;
      }
      const result = await json('/api/catalog/lookup-confirm', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({isbn})});
      $('#catalogDialog').close(); event.target.reset(); state.catalogPreview = null; await Promise.all([loadCatalogData(), loadCatalogStatus()]); toast(`Katalog: ${result.decision}.`);
    } catch (error) { $('#catalogFormMessage').textContent = `Nie zapisano rekordu: ${error.message}`; toast(error.message); } finally { $('#catalogSubmit').disabled = false; }
    return;
  }
  const title = $('#catalogTitle').value.trim(), isbn = $('#catalogManualIsbn').value.trim(); if (!title) return toast('Podaj tytul dziela.');
  const data = await json('/api/catalog', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title, isbn})}); state.history = data.catalog; $('#catalogDialog').close(); event.target.reset(); await loadHistory(); renderCatalog(); toast('Reczny rekord katalogowy zostal zapisany.');
}

$('.nav-item').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('#scannerBrowseOffers').addEventListener('click', () => showView('offers'));
$('#scannerOfferSearch').addEventListener('input', renderScannerOffers);
$('#scannerOfferSource').addEventListener('change', renderScannerOffers);
$('#refreshView').addEventListener('click', () => Promise.all([loadHistory(), loadCatalogStatus(), loadCatalogData()]).then(() => toast('Dane odswiezone.')));
$('#toggleSources').addEventListener('click', () => { const boxes = $$('#sourceGrid input'); const all = boxes.length && boxes.every(box => box.checked); boxes.forEach(box => { box.checked = !all; }); });
$('#startSearch').addEventListener('click', startSearch); $('#goToOffers').addEventListener('click', () => showView('offers'));
for (const selector of ['#reviewSearch', '#reviewSource', '#reviewIsbn', '#reviewSort']) $(selector).addEventListener(selector === '#reviewSearch' ? 'input' : 'change', renderReview);
for (const selector of ['#catalogSearch', '#catalogSort']) $(selector).addEventListener(selector === '#catalogSearch' ? 'input' : 'change', renderCatalog);
for (const selector of ['#offerSearch', '#offerSource', '#offerStatus', '#offerSort']) $(selector).addEventListener(selector === '#offerSearch' ? 'input' : 'change', () => { state.offerPage = 1; renderOffers(); });
$('#offerPrev').addEventListener('click', () => { state.offerPage -= 1; renderOffers(); }); $('#offerNext').addEventListener('click', () => { state.offerPage += 1; renderOffers(); }); $('#closeOfferDrawer').addEventListener('click', () => { $('#offerDrawer').hidden = true; });
$('#openCatalogForm').addEventListener('click', () => { $('#catalogDialog').showModal(); setCatalogMode('manual'); }); $('#closeCatalogForm').addEventListener('click', () => $('#catalogDialog').close()); $('#cancelCatalogForm').addEventListener('click', () => $('#catalogDialog').close());
$$('[data-catalog-mode]').forEach(button => button.addEventListener('click', () => setCatalogMode(button.dataset.catalogMode))); $('#catalogForm').addEventListener('submit', submitCatalog); $('#runDiagnostics').addEventListener('click', runDiagnostics);

showView(new URLSearchParams(location.search).get('view') || 'scanner');
Promise.all([loadSources(), loadHistory(), loadCatalogStatus(), loadCatalogData()]).catch(error => { $('#connectionLabel').textContent = 'Blad polaczenia'; toast(`Nie udalo sie wczytac aplikacji: ${error.message}`); });
