import { createReviewView } from './views/review.js';
import { createCatalogView } from './views/catalog.js';
import { createOffersView } from './views/offers.js';
import { json } from './core/api.js';
import { escapeHtml, money, date, shortTime } from './core/formatters.js';
import { createSettingsView } from './views/settings.js';
import { createScannerView } from './views/scanner.js';
import { readSavedSearch, validateCatalogPage } from './frontend-utils.js';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  activeView: 'scanner',
  sources: [],
  history: null,
  catalog: null,
  catalogWorks: [],
  reviewJobs: [],
  sqliteOffers: [],
  reviewDetail: null,
  catalogMode: 'manual',
  catalogPreview: null,
  scan: {
    running: false,
    startedAt: null,
    timer: null,
    total: 0,
    completed: 0,
    rows: new Map(),
    result: null,
    fingerprint: null,
    lastStart: 0,
  },
  selectedReviewId: null,
  selectedCatalogId: null,
  offerPage: 1,
  pageSize: 25,
  catalogPages: {
    works: { total: 0, offset: 0 },
    jobs: { total: 0, offset: 0 },
    offers: { total: 0, offset: 0 },
  },
  visibleRows: { works: 100, jobs: 100 },
};

const savedSearch = readSavedSearch(localStorage);
$('#queries').value = savedSearch?.queries?.join('\n') || '';

function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  $('#toastRegion').append(node);
  setTimeout(() => node.remove(), 4200);
}
function selectedSources() {
  return $$('#sourceGrid input:checked').map((input) => input.value);
}
function readQueries() {
  return [
    ...new Set(
      $('#queries')
        .value.split(/\n|,/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].slice(0, 10);
}
function bookFor(id) {
  return (state.history?.books || []).find((row) => row.book.id === id)?.book || null;
}
function allOffers() {
  return state.sqliteOffers;
}
function reviewOffers() {
  return state.reviewJobs;
}
function renderScannerOffers() {
  const mount = $('#scannerOfferList');
  if (!mount) return;
  const all = [...allOffers()];
  const sourceSelect = $('#scannerOfferSource');
  const activeSource = sourceSelect.value;
  const sources = [...new Set(all.map((item) => item.source).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'pl'),
  );
  sourceSelect.innerHTML =
    '<option value="">Wszystkie źródła</option>' +
    sources
      .map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`)
      .join('');
  sourceSelect.value = sources.includes(activeSource) ? activeSource : '';
  const needle = $('#scannerOfferSearch').value.trim().toLocaleLowerCase('pl');
  const filtered = all
    .filter(
      (item) =>
        (!sourceSelect.value || item.source === sourceSelect.value) &&
        (!needle ||
          `${item.title || item.originalTitle || ''} ${item.source || ''} ${item.observedIsbn || item.isbn || ''}`
            .toLocaleLowerCase('pl')
            .includes(needle)),
    )
    .sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
  const offers = filtered.slice(0, 12);
  $('#scannerOfferCount').textContent =
    `Pokazano ${offers.length} z ${filtered.length} pasujących ofert`;
  $('#scannerDiscoverSummary').textContent =
    'Ostatnio zapisane oferty SQLite. Nie są to wyniki bieżącego skanu.';
  mount.innerHTML = offers.length
    ? offers
        .map((item) => {
          const title = item.title || item.originalTitle || 'Tytuł nieznany';
          const isbn = item.observedIsbn || item.isbn || 'ISBN nieznany';
          return `<button class="scanner-offer-row" type="button" data-scanner-offer-id="${escapeHtml(item.id)}"><span class="book-spine" aria-hidden="true">▤</span><span class="scanner-offer-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(item.source)} · ${escapeHtml(isbn)}</small><small>${escapeHtml(date(item.lastSeenAt))}</small></span><span class="scanner-offer-price">${money(item.currentPrice)}</span></button>`;
        })
        .join('')
    : '<div class="empty-detail"><p>Brak ofert zgodnych z filtrami albo baza jest pusta.</p></div>';
  mount
    .querySelectorAll('[data-scanner-offer-id]')
    .forEach((button) =>
      button.addEventListener('click', () => openOfferDrawer(button.dataset.scannerOfferId)),
    );
}

function showView(name) {
  if (!['scanner', 'review', 'catalog', 'offers', 'settings'].includes(name)) name = 'scanner';
  state.activeView = name;
  $$('.view').forEach((view) => {
    view.hidden = view.id !== `view-${name}`;
    view.classList.toggle('active', !view.hidden);
  });
  $$('.nav-item').forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#viewTitle').textContent = $(`#view-${name}`).dataset.title;
  history.replaceState(null, '', name === 'scanner' ? '/' : `/?view=${name}`);
  if (name === 'review') renderReview();
  if (name === 'catalog') renderCatalog();
  if (name === 'offers') renderOffers();
  if (name === 'scanner') renderScannerOffers();
  if (name === 'settings') renderSettings();
}

async function loadSources() {
  const data = await json('/api/sources');
  state.sources = data.sources || [];
  const chosen = new Set(savedSearch?.sources || state.sources);
  $('#sourceGrid').innerHTML =
    state.sources
      .map(
        (source) =>
          `<label class="source-option"><input type="checkbox" value="${escapeHtml(source)}" ${chosen.has(source) ? 'checked' : ''}><span>${escapeHtml(source)}</span></label>`,
      )
      .join('') || '<span class="loading-copy">Brak aktywnych adapterow.</span>';
  $('#settingsSources').innerHTML = state.sources
    .map((source) => `<span><b>${escapeHtml(source)}</b><small>Aktywny adapter</small></span>`)
    .join('');
  fillSourceFilters();
}

function fillSourceFilters() {
  const options = state.sources
    .map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`)
    .join('');
  for (const selector of ['#reviewSource', '#offerSource']) {
    const select = $(selector);
    const value = select.value;
    select.innerHTML = `<option value="">Wszystkie źródła</option>${options}`;
    select.value = value;
  }
}

async function loadHistory() {
  state.history = await json('/api/history');
  $('#offersNavCount').textContent = `${allOffers().length} zapisanych`;
  $('#reviewNavCount').textContent = `${state.catalogPages.jobs.total} pozycji`;
  renderReview();
  renderCatalog();
  renderOffers();
  renderScannerOffers();
}

// API pages are limited to 250 rows. Read subsequent pages rather than silently
// hiding catalog records after the first page. A larger dataset needs server-side UX.
const catalogSources = {
  works: { endpoint: '/api/catalog/works', stateKey: 'catalogWorks', view: 'catalog' },
  jobs: { endpoint: '/api/identification-jobs', stateKey: 'reviewJobs', view: 'review' },
  offers: { endpoint: '/api/offers', stateKey: 'sqliteOffers', view: 'offers' },
};
const catalogPageSize = 250;
const loadingCatalogPages = new Set();
const catalogAbortControllers = new Map();
const catalogSearchTimers = new Map();
const catalogSearchInputs = {
  works: '#catalogSearch',
  jobs: '#reviewSearch',
  offers: '#offerSearch',
};
function catalogQuery(kind) {
  return $(catalogSearchInputs[kind])?.value?.trim() || '';
}
function catalogFilters(kind) {
  const query = catalogQuery(kind);
  if (kind === 'works') return { query, sort: $('#catalogSort').value };
  if (kind === 'jobs')
    return {
      query,
      source: $('#reviewSource').value,
      isbn: $('#reviewIsbn').value,
      sort: $('#reviewSort').value,
    };
  return {
    query,
    source: $('#offerSource').value,
    status: $('#offerStatus').value,
    sort: $('#offerSort').value,
  };
}

// Fetch one page at a time. A large catalog must not block the UI by
// attempting to download every row on startup.
async function loadCatalogPage(kind, { reset = false } = {}) {
  const source = catalogSources[kind];
  if (!source) return false;
  if (reset) catalogAbortControllers.get(kind)?.abort();
  else if (loadingCatalogPages.has(kind)) return false;
  const page = state.catalogPages[kind];
  if (!reset && page.offset >= page.total) return false;
  loadingCatalogPages.add(kind);
  const controller = new AbortController();
  catalogAbortControllers.set(kind, controller);
  updateCatalogLoadControls();
  try {
    const offset = reset ? 0 : page.offset;
    const filters = reset ? catalogFilters(kind) : page.filters || { query: page.query || '' };
    const query = filters.query;
    const params = new URLSearchParams({ limit: String(catalogPageSize), offset: String(offset) });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    const response = await fetch(`${source.endpoint}?${params}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || `HTTP_${response.status}`);
    if (controller.signal.aborted) return false;
    validateCatalogPage(data, catalogPageSize, offset);
    if (!reset && data.total !== page.total) throw Error('CATALOG_CHANGED_DURING_PAGINATION');
    if (data.items.length === 0 && offset < data.total) throw Error('INCOMPLETE_CATALOG_PAGE');
    if (reset) {
      state[source.stateKey] = data.items;
      if (kind === 'works' || kind === 'jobs') state.visibleRows[kind] = 100;
    } else state[source.stateKey] = [...state[source.stateKey], ...data.items];
    state.catalogPages[kind] = {
      total: data.total,
      offset: offset + data.items.length,
      query,
      filters,
    };
    updateCatalogLoadControls();
    return true;
  } finally {
    if (catalogAbortControllers.get(kind) === controller) {
      loadingCatalogPages.delete(kind);
      catalogAbortControllers.delete(kind);
      updateCatalogLoadControls();
    }
  }
}

function scheduleGlobalCatalogSearch(kind) {
  clearTimeout(catalogSearchTimers.get(kind));
  const timer = setTimeout(async () => {
    try {
      const changed = await loadCatalogPage(kind, { reset: true });
      if (changed) {
        if (kind === 'works') renderCatalog();
        if (kind === 'jobs') renderReview();
        if (kind === 'offers') {
          state.offerPage = 1;
          renderOffers();
          renderScannerOffers();
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') toast('Wyszukiwanie SQLite: ' + error.message);
    }
  }, 350);
  catalogSearchTimers.set(kind, timer);
}

function updateCatalogLoadControls() {
  for (const [kind, source] of Object.entries(catalogSources)) {
    const view = document.querySelector('#view-' + source.view);
    if (!view) continue;
    let control = view.querySelector('[data-load-catalog-kind="' + kind + '"]');
    if (!control) {
      control = document.createElement('button');
      control.type = 'button';
      control.className = 'button-secondary catalog-load-more';
      control.dataset.loadCatalogKind = kind;
      view.append(control);
      control.addEventListener('click', async () => {
        control.disabled = true;
        try {
          if (await loadCatalogPage(kind)) {
            if (kind === 'works') renderCatalog();
            if (kind === 'jobs') renderReview();
            if (kind === 'offers') {
              renderOffers();
              renderScannerOffers();
            }
          }
        } catch (error) {
          toast('Nie udało się pobrać kolejnej strony: ' + error.message);
        } finally {
          updateCatalogLoadControls();
        }
      });
    }
    const page = state.catalogPages[kind],
      busy = loadingCatalogPages.has(kind);
    control.hidden = page.offset >= page.total;
    control.disabled = busy;
    control.textContent = busy
      ? 'Wczytywanie...'
      : `Pokaż kolejne (wczytano ${page.offset} z ${page.total})`;
  }
}

async function loadCatalogData() {
  try {
    const loaded = await Promise.all([
      loadCatalogPage('works', { reset: true }),
      loadCatalogPage('jobs', { reset: true }),
      loadCatalogPage('offers', { reset: true }),
    ]);
    if (loaded.some((value) => value !== true)) throw Error('CATALOG_PAGE_LOAD_IN_PROGRESS');
    state.offerPage = 1;
    $('#offersNavCount').textContent = `${state.catalogPages.offers.total} zapisanych`;
    $('#reviewNavCount').textContent = `${state.catalogPages.jobs.total} pozycji`;
    renderReview();
    renderCatalog();
    renderOffers();
    renderScannerOffers();
    updateCatalogLoadControls();
    return true;
  } catch (error) {
    $('#databaseStatus').textContent = 'SQLite: błąd odczytu katalogu';
    toast(`Nie udało się wczytać katalogu SQLite: ${error.message}`);
    return false;
  }
}

async function loadCatalogStatus() {
  try {
    state.catalog = await json('/api/catalog/status');
    const counts = state.catalog.counts || {};
    $('#databaseStatus').textContent =
      `SQLite: ${counts.works || 0} dzieł / ${counts.editions || 0} wydań`;
    $('#catalogWorks').textContent = counts.works || 0;
    $('#catalogEditions').textContent = counts.editions || 0;
    const statuses = state.catalog.identification?.statuses || {};
    $('#catalogIncomplete').textContent = Number(statuses.review_required || 0);
    $('#settingsDatabaseCopy').textContent = state.catalog.enabled
      ? 'Baza lokalna jest dostepna.'
      : 'Integracja katalogu jest wylaczona.';
    const identification = state.catalog.identification || {};
    const labels = {
      queued: 'W kolejce', running: 'Przetwarzane', retry_wait: 'Ponowna próba',
      review_required: 'Wymaga decyzji', failed: 'Błędy', completed: 'Zakończone',
      matched_existing: 'Przypisane do wydania', created_edition: 'Nowe wydania',
      created_work_and_edition: 'Nowe dzieła i wydania',
      not_found: 'Brak dopasowania',
    };
    const rows = [
      ['Gotowe do przetworzenia', identification.runnable ?? 0],
      ['Oczekujące na termin ponowienia', identification.waiting ?? 0],
      ...Object.entries(identification.statuses || {}),
      ...Object.entries(identification.decisions || {}).map(([key,value]) => ['Automatycznie: ' + (labels[key] || key),value]),
      ...Object.entries(identification.manualDecisions || {}).map(([key,value]) => ['Ręcznie: ' + ({approved:'zatwierdzone',not_book:'nie-książka',requeued:'ponowione',proposal_rejected:'odrzucona propozycja'}[key] || key),value]),
      ...(identification.failureReasons || []).map((item) => [
        'Błąd: ' + item.code, item.count,
      ]),
    ];
    $('#identificationStats').innerHTML = rows.length
      ? rows.map(([key, value]) => `<span><b>${escapeHtml(labels[key] || key)}</b><small>${Number(value)}</small></span>`).join('')
      : '<span><small>Brak zadań identyfikacji.</small></span>';
    $('#settingsDatabaseStats').innerHTML = Object.entries(counts)
      .slice(0, 8)
      .map(
        ([key, value]) =>
          `<span><b>${escapeHtml(key.replaceAll('_', ' '))}</b><small>${value}</small></span>`,
      )
      .join('');
    $('#connectionDot').classList.add('online');
    $('#connectionLabel').textContent = 'Aplikacja online';
    return true;
  } catch {
    state.catalog = null;
    $('#databaseStatus').textContent = 'SQLite: niedostepny';
    $('#settingsDatabaseCopy').textContent = 'Nie udalo sie odczytac statusu bazy.';
    $('#connectionDot').classList.remove('online');
    $('#connectionLabel').textContent = 'Błąd połączenia';
    return false;
  }
}

const { startSearch, renderSourceRows } = createScannerView({
  state, $, escapeHtml, shortTime, readQueries, selectedSources, toast,
  loadHistory, loadCatalogStatus, loadCatalogData,
});

const { renderSettings, runDiagnostics } = createSettingsView({ state, $, escapeHtml, loadCatalogStatus });

function visibleCatalogRows(...args) { return reviewView.visibleCatalogRows(...args); }
function renderReview(...args) { return reviewView.renderReview(...args); }

function renderCatalog(...args) { return catalogView.renderCatalog(...args); }
function priceStats(...args) { return catalogView.priceStats(...args); }

function renderOffers(...args) { return offersView.renderOffers(...args); }
function openOfferDrawer(...args) { return offersView.openOfferDrawer(...args); }

function setCatalogMode(mode) {
  state.catalogMode = mode;
  state.catalogPreview = null;
  $$('[data-catalog-mode]').forEach((button) =>
    button.classList.toggle('active', button.dataset.catalogMode === mode),
  );
  $('#catalogIsbnMode').hidden = mode !== 'isbn';
  $('#catalogManualMode').hidden = mode !== 'manual';
  $('#catalogSubmit').disabled = false;
  $('#catalogSubmit').textContent = mode === 'isbn' ? 'Sprawdź ISBN' : 'Zapisz rekord';
  $('#catalogFormMessage').hidden = true;
  $('#catalogFormMessage').textContent = '';
}

async function submitCatalog(event) {
  event.preventDefault();
  if (state.catalogMode === 'isbn') {
    const isbn = $('#catalogIsbn').value.trim();
    if (!isbn) return toast('Podaj ISBN.');
    $('#catalogSubmit').disabled = true;
    $('#catalogFormMessage').hidden = false;
    $('#catalogFormMessage').textContent =
      'Sprawdzanie katalogu lokalnego oraz metadanych BN/OL...';
    try {
      if (!state.catalogPreview) {
        state.catalogPreview = await json('/api/catalog/lookup-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isbn }),
        });
        const records = [state.catalogPreview.bn, state.catalogPreview.openLibrary].flatMap(
          (result) => result?.records || [],
        );
        $('#catalogFormMessage').textContent = records.length
          ? `${state.catalogPreview.comparison.status}: ${records.map((record) => `${record.source} — ${record.title || 'bez tytułu'}`).join(' | ')}. Kliknij ponownie, aby zatwierdzić utworzenie rekordu.`
          : 'Nie znaleziono jednoznacznego rekordu. Nic nie zapisano.';
        $('#catalogSubmit').textContent = records.length ? 'Zatwierdź rekord' : 'Sprawdź ponownie';
        $('#catalogSubmit').disabled = !records.length;
        return;
      }
      const result = await json('/api/catalog/lookup-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn }),
      });
      $('#catalogDialog').close();
      event.target.reset();
      state.catalogPreview = null;
      await Promise.all([loadCatalogData(), loadCatalogStatus()]);
      toast(`Katalog: ${result.decision}.`);
    } catch (error) {
      $('#catalogFormMessage').textContent = `Nie zapisano rekordu: ${error.message}`;
      toast(error.message);
    } finally {
      $('#catalogSubmit').disabled = false;
    }
    return;
  }
  const title = $('#catalogTitle').value.trim(),
    isbn = $('#catalogManualIsbn').value.trim();
  if (!title) return toast('Podaj tytul dziela.');
  const data = await json('/api/catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, isbn }),
  });
  state.history = data.catalog;
  $('#catalogDialog').close();
  event.target.reset();
  await loadHistory();
  renderCatalog();
  toast('Ręczny rekord katalogowy zostal zapisany.');
}

$$('.nav-item').forEach((button) =>
  button.addEventListener('click', () => showView(button.dataset.view)),
);
$('#scannerBrowseOffers').addEventListener('click', () => showView('offers'));
$('#scannerOfferSearch').addEventListener('input', renderScannerOffers);
$('#scannerOfferSource').addEventListener('change', renderScannerOffers);
$('#retryIdentification').addEventListener('click', async () => {
  const button = $('#retryIdentification');
  const mode = $('#retryMode').value;
  if (!confirm('Ponowić identyfikację wybranej grupy? Ręczne przypisania zostaną zachowane.')) return;
  button.disabled = true;
  try {
    const result = await json('/api/identification/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    toast('Dodano do kolejki: ' + result.queued);
    await loadCatalogStatus();
    await loadCatalogData();
  } catch (error) {
    toast('Nie udało się ponowić identyfikacji: ' + error.message);
  } finally { button.disabled = false; }
});
$('#refreshView').addEventListener('click', async () => {
  const button = $('#refreshView');
  button.disabled = true;
  try {
    const [historyResult, catalogResult, catalogDataOk] = await Promise.allSettled([
      loadHistory(),
      loadCatalogStatus(),
      loadCatalogData(),
    ]);
    const errors = [historyResult, catalogResult].filter((result) => result.status === 'rejected');
    if (
      errors.length ||
      catalogResult.value !== true ||
      catalogDataOk.status !== 'fulfilled' ||
      catalogDataOk.value !== true
    ) {
      toast('Nie wszystkie dane odświeżono. Sprawdź stan katalogu SQLite.');
      return;
    }
    toast('Dane odświeżone.');
  } finally {
    button.disabled = false;
  }
});
$('#toggleSources').addEventListener('click', () => {
  const boxes = $$('#sourceGrid input');
  const all = boxes.length && boxes.every((box) => box.checked);
  boxes.forEach((box) => {
    box.checked = !all;
  });
});
$('#startSearch').addEventListener('click', startSearch);
$('#goToOffers').addEventListener('click', () => showView('offers'));
for (const selector of ['#reviewSource', '#reviewIsbn', '#reviewSort'])
  $(selector).addEventListener('change', () => scheduleGlobalCatalogSearch('jobs'));
$('#reviewSearch').addEventListener('input', () => scheduleGlobalCatalogSearch('jobs'));
$('#catalogSort').addEventListener('change', () => scheduleGlobalCatalogSearch('works'));
$('#catalogSearch').addEventListener('input', () => scheduleGlobalCatalogSearch('works'));
for (const selector of ['#offerSource', '#offerStatus', '#offerSort'])
  $(selector).addEventListener('change', () => scheduleGlobalCatalogSearch('offers'));
$('#offerSearch').addEventListener('input', () => scheduleGlobalCatalogSearch('offers'));
$('#offerPrev').addEventListener('click', () => {
  state.offerPage -= 1;
  renderOffers();
});
$('#offerNext').addEventListener('click', () => {
  state.offerPage += 1;
  renderOffers();
});
$('#closeOfferDrawer').addEventListener('click', () => {
  $('#offerDrawer').hidden = true;
});
$('#openCatalogForm').addEventListener('click', () => {
  $('#catalogDialog').showModal();
  setCatalogMode('manual');
});
$('#closeCatalogForm').addEventListener('click', () => $('#catalogDialog').close());
$('#cancelCatalogForm').addEventListener('click', () => $('#catalogDialog').close());
$$('[data-catalog-mode]').forEach((button) =>
  button.addEventListener('click', () => setCatalogMode(button.dataset.catalogMode)),
);
$('#catalogForm').addEventListener('submit', submitCatalog);
$('#runDiagnostics').addEventListener('click', runDiagnostics);

async function restoreLastScanStatus() {
  try {
    const status = await json('/api/scan/status');
    if (state.scan.running) return;
    if (status.status === 'running') {
      $('#scanStateBadge').textContent = 'Skan trwa';
      $('#scanStateBadge').className = 'state-badge warning';
      $('#scanGuardMessage').textContent = 'Skan działa na serwerze. Nie uruchamiaj kolejnego.';
    } else if (status.status === 'interrupted') {
      $('#scanStateBadge').textContent = 'Skan przerwany';
      $('#scanStateBadge').className = 'state-badge warning';
      $('#scanGuardMessage').textContent = 'Poprzedni skan został przerwany przy zamknięciu serwera.';
    } else if (status.status === 'completed') {
      $('#scanStateBadge').textContent = 'Ostatni skan ukończony';
      $('#scanStateBadge').className = 'state-badge neutral';
    } else if (status.status === 'failed') {
      $('#scanStateBadge').textContent = 'Ostatni skan nieudany';
      $('#scanStateBadge').className = 'state-badge warning';
    }
  } catch {
    // The scanner can still operate when the status endpoint is unavailable.
  }
}

const reviewView = createReviewView({ state, $, $$, json, toast, money, date, escapeHtml, reviewOffers, loadCatalogData, renderCatalog });
const catalogView = createCatalogView({ state, $, $$, json, money, escapeHtml, visibleCatalogRows });
const offersView = createOffersView({ state, $, $$, json, money, date, escapeHtml, allOffers, bookFor, showView, priceStats });

showView(new URLSearchParams(location.search).get('view') || 'scanner');
Promise.all([loadSources(), loadHistory(), loadCatalogStatus(), loadCatalogData(), restoreLastScanStatus()]).catch(
  (error) => {
    $('#connectionLabel').textContent = 'Błąd połączenia';
    toast(`Nie udało się wczytać aplikacji: ${error.message}`);
  },
);
