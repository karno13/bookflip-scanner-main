import { installDetailNavigation, openDetailView } from './core/detail-navigation.js';
import { hasUnsavedChanges, confirmDiscard, statusLabel } from './core/ux.js';
import { viewFromSearch, idFromSearch, urlForView, shouldPush } from './core/view-history.js';
import { identificationProgress } from './core/identification-progress.js';
import { installTradingControls } from './views/trading-controls.js';
import { installDashboard } from './views/dashboard.js';
import { installScanProfiles } from './views/scan-profiles.js';
import { createScanInsights } from './views/scan-insights.js';
import { createSetsView } from './views/sets.js';
import { createReviewView } from './views/review.js';
import { createCatalogView } from './views/catalog.js';
import { mountDuplicates } from './views/duplicates.js';
import { mountScanSchedule } from './views/scan-schedule.js';
import { createOffersView } from './views/offers.js';
import { json } from './core/api.js';
import { escapeHtml, money, date, shortTime } from './core/formatters.js';
import { createSettingsView } from './views/settings.js';
import { createScannerView } from './views/scanner.js';
import { requestScanCancellation } from './views/scanner.js';
import { readSavedSearch, validateCatalogPage } from './frontend-utils.js';
import { installCoverFallback, coverMarkup, tidyOfferTitle } from './core/bibliography.js';
import { installPreferences } from './core/preferences.js';
import { installCommandPalette } from './views/palette.js';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  activeView: 'catalog',
  sources: [],
  history: null,
  catalog: null,
  catalogWorks: [],
  reviewJobs: [],
  sqliteOffers: [],
  scannerOffers: [],
  scannerTotal: 0,
  reviewDetail: null,
  catalogMode: 'manual',
  catalogPreview: null,
  catalogReturnToReview: null,
  reviewPendingEdition: null,
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
  offerView: 'all',
  reviewScan: '',
  scanRuns: [],
  offerPage: 1,
  pageSize: 25,
  catalogPages: {
    works: { total: 0, offset: 0 },
    jobs: { total: 0, offset: 0 },
    offers: { total: 0, offset: 0 },
  },
  visibleRows: { works: 100, jobs: 100 },
};
// Any code that changes the selected item (clicks, auto-advance after a decision, restore) updates the address.
for (const key of ['selectedReviewId', 'selectedCatalogId']) {
  let value = state[key];
  Object.defineProperty(state, key, { enumerable: true, configurable: true, get: () => value, set: (next) => { value = next; queueMicrotask(syncItemUrl); } });
}

const savedSearch = readSavedSearch(localStorage);
$('#queries').value = savedSearch?.queries?.join('\n') || '';

function toast(message, action = null) {
  const node = document.createElement('div');
  node.className = 'toast';
  const copy = document.createElement('span');
  copy.textContent = message;
  node.append(copy);
  if (action?.label && typeof action.onClick === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await action.onClick(); node.remove(); }
      catch (error) { button.disabled = false; action.onError?.(error); }
    });
    node.append(button);
  }
  $('#toastRegion').append(node);
  setTimeout(() => node.remove(), action ? 8000 : 4200);
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
  ];
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
  const all = [...state.scannerOffers];
  const sourceSelect = $('#scannerOfferSource');
  const activeSource = sourceSelect.value;
  const sources = [...new Set([...state.sources,...all.map((item) => item.source)].filter(Boolean))].sort((a, b) =>
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
    `Pokazano ${offers.length} z ${state.scannerTotal} pasujących ofert`;
  $('#scannerDiscoverSummary').textContent =
    'Ostatnio zapisane oferty SQLite. Nie są to wyniki bieżącego skanu.';
  mount.innerHTML = offers.length
    ? offers
        .map((item) => {
          const title = tidyOfferTitle(item.title || item.originalTitle || 'Tytuł nieznany');
          const isbn = item.observedIsbn || item.isbn || 'ISBN nieznany';
          return `<button class="scanner-offer-row" type="button" data-scanner-offer-id="${escapeHtml(item.id)}">${coverMarkup(item.image, title, { size: 'sm', escapeHtml })}<span class="scanner-offer-copy"><strong>${escapeHtml(title)}</strong><small><span class="source-dot" data-source="${escapeHtml(item.source)}"></span>${escapeHtml(item.source)} · ${escapeHtml(isbn)}</small><small>${escapeHtml(date(item.lastSeenAt))}</small></span><span class="scanner-offer-price">${money(item.currentPrice)}</span></button>`;
        })
        .join('')
    : '<div class="empty-detail"><p>Brak ofert zgodnych z filtrami albo baza jest pusta.</p></div>';
  mount
    .querySelectorAll('[data-scanner-offer-id]')
    .forEach((button) =>
      button.addEventListener('click', () => openOfferDrawer(button.dataset.scannerOfferId)),
    );
}

// Keeps ?id= in the address equal to the item selected in the active list/detail view.
// Disabled until the startup restore has finished so a deep link is not wiped by early renders.
let itemUrlReady = false;
function selectedItemId(view) {
  if (view === 'catalog') return state.selectedCatalogId;
  if (view === 'review') return state.selectedReviewId;
  if (view === 'sets') return setsView.activeId();
  return null;
}
function syncItemUrl() {
  if (!itemUrlReady) return;
  const view = state.activeView;
  const target = urlForView(view, selectedItemId(view));
  if (location.pathname + location.search !== target) history.replaceState(history.state, '', target);
}
// Opens the item named in the URL once its data is available. Unknown ids are ignored.
async function restoreItem(view, id) {
  if (!id) return;
  try {
    if (view === 'catalog') await catalogView.openCatalogDetail(id);
    else if (view === 'review') { state.selectedReviewId = id; renderReview(); openDetailView('review'); }
    else if (view === 'sets') { await setsView.refreshSets(id); openDetailView('sets'); }
  } catch (error) { toast(error.message); }
}

let firstViewRender = true;
// Returns true when the view was switched, false when the user kept unsaved changes.
// options.fromHistory: called by popstate, the URL is already correct and must not be touched.
function showView(name, options = {}) {
  if (!['scanner', 'review', 'catalog', 'sets', 'offers', 'settings'].includes(name)) name = 'scanner';
  if (hasUnsavedChanges()) {
    // Ask without blocking the page; the switch continues only after the user agrees.
    void confirmDiscard().then((ok) => { if (ok) showView(name, options); });
    return false;
  }
  state.activeView = name;
  $$('.view').forEach((view) => {
    view.hidden = view.id !== `view-${name}`;
    view.classList.toggle('active', !view.hidden);
  });
  $$('.nav-item, .mobile-nav-item').forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#viewTitle').textContent = $(`#view-${name}`).dataset.title;
  if (!options.fromHistory) {
    const current = location.pathname + location.search;
    // Reloading or re-entering the same view keeps the selected item in the address.
    const sameView = viewFromSearch(location.search) === name;
    const keepId = sameView ? idFromSearch(location.search) : null;
    if (shouldPush(current, name, firstViewRender)) history.pushState({ view: name }, '', urlForView(name));
    else history.replaceState({ view: name }, '', urlForView(name, keepId));
  }
  firstViewRender = false;
  if (name === 'scanner') refreshWorkflowDashboard?.();
  if(['sets','settings'].includes(name)) $('#mobileMore')?.setAttribute('aria-current','page');
  else $('#mobileMore')?.removeAttribute('aria-current');
  if (name === 'review') { renderReview(); void tradingControls?.refreshDecisions(); }
  if (name === 'catalog') renderCatalog();
  if (name === 'offers') renderOffers();
  if (name === 'scanner') { renderScannerOffers(); void refreshScannerOffers(); }
  if (name === 'settings') { renderSettings(); void tradingControls?.refreshSettings(); }
  if (name === 'sets') void setsView.refreshSets().catch(error => toast(error.message));
  return true;
}

// Browser back/forward between workspaces. Unsaved changes can veto the move; in that case the
// URL is restored so the address bar keeps matching what is on screen.
window.addEventListener('popstate', () => {
  const target = viewFromSearch(location.search);
  if (target === state.activeView) return;
  if (hasUnsavedChanges()) {
    history.pushState({ view: state.activeView }, '', urlForView(state.activeView));
    void confirmDiscard().then((ok) => { if (ok) showView(target); });
    return;
  }
  showView(target, { fromHistory: true });
  void restoreItem(target, idFromSearch(location.search));
});

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
    .map((source) => `<span><b>${escapeHtml(source)}</b><small>Dostępny w programie · brak potwierdzenia działania</small></span>`)
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
  state.history = await json('/api/history/brief');
  $('#offersNavCount').textContent = `${allOffers().length} zapisanych`;
  $('#reviewNavCount').textContent = `${state.catalogPages.jobs.total} pozycji`;
  renderReview();
  renderCatalog();
  renderOffers();
  renderScannerOffers();
  await refreshScannerOffers();
}
let scannerSearchSerial=0;
async function refreshScannerOffers() {
  const serial=++scannerSearchSerial;
  try {
    const data=await json('/api/offers?'+new URLSearchParams({limit:'12',query:$('#scannerOfferSearch').value.trim(),source:$('#scannerOfferSource').value}));
    if(serial!==scannerSearchSerial)return;
    state.scannerOffers=data.items;state.scannerTotal=data.total;renderScannerOffers();
  }catch(error){$('#scannerOfferCount').textContent='Nie udało się pobrać ofert. Spróbuj odświeżyć.';}
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
  if (kind === 'works') return { query, sort: $('#catalogSort').value, language:$('#catalogLanguage').value.trim(),publisher:$('#catalogPublisher').value.trim(),year:$('#catalogYear').value,binding:$('#catalogBinding').value.trim() };
  if (kind === 'jobs')
    return {
      query,
      source: $('#reviewSource').value,
      scan: state.reviewScan,
      isbn: $('#reviewIsbn').value,
      status:'review_required',
      offerId:state.reviewOffer || '',
      sort: $('#reviewSort').value,
    };
  return {
    query,
    source: $('#offerSource').value,
    status: $('#offerStatus').value,
    watched:state.offerView==='watched'?'1':'',target:state.offerView==='target'?'1':'',
    purchaseStatus:['check','negotiating','bought','rejected'].includes(state.offerView)?state.offerView:'',
    scan:$('#offerScan').value,scanChange:$('#offerScanChange').value,
    minPrice:$('#offerMinPrice').value,maxPrice:$('#offerMaxPrice').value,
    sort: $('#offerSort').value,
  };
}

// Fetch one page at a time. A large catalog must not block the UI by
// attempting to download every row on startup.
async function loadCatalogPage(kind, { reset = false, pageNumber = null } = {}) {
  const source = catalogSources[kind];
  if (!source) return false;
  if (reset) catalogAbortControllers.get(kind)?.abort();
  else if (loadingCatalogPages.has(kind)) return false;
  const page = state.catalogPages[kind];
  if (!reset && pageNumber === null && page.offset >= page.total) return false;
  loadingCatalogPages.add(kind);
  const controller = new AbortController();
  catalogAbortControllers.set(kind, controller);
  updateCatalogLoadControls();
  try {
    const limit = kind === 'offers' ? state.pageSize : catalogPageSize;
    const requestedPage = pageNumber ?? (reset ? 1 : state.offerPage + 1);
    let offset = kind === 'offers' ? (requestedPage - 1) * limit : reset ? 0 : page.offset;
    const filters = reset ? catalogFilters(kind) : page.filters || { query: page.query || '' };
    const query = filters.query;
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    const response = await fetch(`${source.endpoint}?${params}`, { signal: controller.signal });
    let data = await response.json();
    if (!response.ok) throw Error(data.error || `HTTP_${response.status}`);
    if (controller.signal.aborted) return false;
    if (kind === 'offers' && offset >= data.total && offset > 0) {
      offset = Math.max(0,Math.ceil(data.total/limit)-1)*limit;
      params.set('offset',String(offset));
      data=await json(source.endpoint+'?'+params);
    }
    validateCatalogPage(data, limit, offset);
    if (!reset && kind !== 'offers' && data.total !== page.total) throw Error('CATALOG_CHANGED_DURING_PAGINATION');
    if (data.items.length === 0 && offset < data.total) throw Error('INCOMPLETE_CATALOG_PAGE');
    if (reset || kind === 'offers') {
      state[source.stateKey] = data.items;
      if (kind === 'works' || kind === 'jobs') state.visibleRows[kind] = 100;
    } else state[source.stateKey] = [...state[source.stateKey], ...data.items];
    if (kind === 'offers') state.offerPage = Math.floor(offset / limit) + 1;
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
      if(kind==='offers') state.offerPage=1;
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
    if (kind === 'jobs' || kind === 'offers') {
      control?.remove();
      continue; // Review list loads more as it is scrolled.
    }
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
      loadCatalogPage('offers', { reset: true, pageNumber:state.offerPage }),
    ]);
    if (loaded.some((value) => value !== true)) throw Error('CATALOG_PAGE_LOAD_IN_PROGRESS');
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
    scanInsights.refreshIsbn(state.catalog);
    const counts = state.catalog.counts || {};
    $('#databaseStatus').textContent = `${counts.offers || 0} ofert · dane dostępne`;
    $('#catalogWorks').textContent = counts.works || 0;
    $('#catalogEditions').textContent = counts.editions || 0;
    const identification = state.catalog.identification || {};
    const run = identification.run;
    const runHasTasks = Object.values(run?.statuses || {}).some((value) => Number(value) > 0);
    const scope = runHasTasks ? run : identification;
    const statuses = scope.statuses || {};
    const progress=identificationProgress(statuses);
    const {total,processed,percent}=progress;
    $('#identificationProgressScope').textContent = runHasTasks ? 'Bieżące uruchomienie' : 'Wszystkie zapisane zadania';
    $('#identificationProgressBar').value = percent;
    $('#identificationProgressLabel').textContent = total
      ? `${percent}% · ${processed} / ${total}` : 'Brak zadań';
    $('#identificationProgressDetails').textContent =
      `W kolejce: ${Number(statuses.queued || 0)} · Przetwarzane: ${Number(statuses.running || 0)} · Ponawiane: ${Number(statuses.retry_wait || 0)} · Do weryfikacji: ${Number(statuses.review_required || 0)} · Błędy: ${Number(statuses.failed || 0)}`;

    const scheduler = state.catalog.scheduler || {};
    const running = scheduler.running === true;
    const active = scheduler.active === true;
    const paused = scheduler.paused === true;
    const decisions = scope.decisions || {};
    const unresolved = Number(identification.statuses?.review_required || 0) +
      Number(identification.statuses?.failed || 0) + Number(identification.decisions?.not_found || 0);
    $('#identificationStart').disabled = scheduler.available === false || active ||
      (running && progress.pending > 0) || identificationControlPending;
    $('#identificationStart').textContent = !progress.pending && unresolved ? 'Uruchom ponownie' : 'Start';
    $('#identificationStop').disabled = scheduler.available === false || paused ||
      (!active && progress.pending === 0) || identificationControlPending;
    $('#identificationRunState').textContent = scheduler.available === false
      ? 'Sterowanie niedostępne'
      : scheduler.stopping ? 'Zatrzymywanie — kończę rozpoczętą partię'
      : active ? 'Identyfikacja w toku'
      : paused ? 'Zatrzymano'
      : !progress.pending && total ? `Zakończono · ${progress.review} do decyzji · ${progress.failed} błędów`
      : running ? 'Oczekuje na zadania' : 'Gotowe do uruchomienia';

    $('#catalogIncomplete').textContent = Number(identification.statuses?.review_required || 0);
    $('#settingsDatabaseCopy').textContent = state.catalog.enabled
      ? 'Baza lokalna jest dostepna.'
      : 'Integracja katalogu jest wylaczona.';
    $('#identificationAssigned').textContent = Number(scope.assigned || 0);
    $('#identificationPending').textContent = progress.pending;
    $('#identificationFailed').textContent = progress.failed;
    $('#scanIsbnMatched').textContent = Number(decisions.matched_existing || 0);
    $('#scanIsbnCreated').textContent = Number(decisions.created_edition || 0) +
      Number(decisions.created_work_and_edition || 0);
    $('#scanIsbnReview').textContent = progress.review;
    $('#scanIsbnNotFound').textContent = Number(decisions.not_found || 0);
    $('#scanIsbnUpdated').textContent = runHasTasks ? 'Bieżące uruchomienie' : 'Wszystkie zapisane zadania';
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
    if(state.activeView==='scanner') void refreshWorkflowDashboard?.();
    return true;
  } catch {
    state.catalog = null;
    $('#databaseStatus').textContent = 'SQLite: niedostepny';
    $('#settingsDatabaseCopy').textContent = 'Nie udało się odczytać statusu bazy.';
    $('#connectionDot').classList.remove('online');
    $('#connectionLabel').textContent = 'Błąd połączenia';
    return false;
  }
}

const { startSearch, renderSourceRows } = createScannerView({
  state, $, escapeHtml, shortTime, readQueries, selectedSources, toast,
  loadHistory, loadCatalogStatus, loadCatalogData,
});

const { renderSettings, runDiagnostics, mountQueryStats } = createSettingsView({ state, $, escapeHtml, loadCatalogStatus });
mountQueryStats(json);

function visibleCatalogRows(...args) { return reviewView.visibleCatalogRows(...args); }
function renderReview(...args) { const result = reviewView.renderReview(...args); syncItemUrl(); return result; }

function renderCatalog(...args) { const result = catalogView.renderCatalog(...args); syncItemUrl(); return result; }
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

function openCatalogForReview({ jobId, isbn = '' }) {
  state.catalogReturnToReview = { jobId, isbn, job: state.reviewJobs.find((item) => item.id === jobId) };
  $('#catalogDialog').showModal();
  $('[data-catalog-mode="isbn"]').click();
  $('#catalogIsbn').value = isbn;
  $('#catalogIsbn').focus();
}

async function restoreReviewAfterCatalog({ editionId = null, isbn = '', title = '' } = {}) {
  const context = state.catalogReturnToReview;
  state.catalogReturnToReview = null;
  if (!context) return;
  const normalized = String(isbn || context.isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  let match = state.catalogWorks.flatMap((work) =>
    work.editions.map((edition) => ({ work, edition })),
  ).find(({ work, edition }) => edition.id === editionId ||
    (normalized && edition.identifiers.some((item) =>
      String(item.value || '').replace(/[^0-9Xx]/g, '').toUpperCase() === normalized)) ||
    (!normalized && title && work.title === title));
  if (!match && editionId) {
    try {
      const edition = await json('/api/catalog/editions/' + encodeURIComponent(editionId));
      const work = await json('/api/catalog/works/' + encodeURIComponent(edition.workId));
      const workIndex = state.catalogWorks.findIndex((item) => item.id === work.id);
      if (workIndex < 0) state.catalogWorks.push(work);
      else state.catalogWorks[workIndex] = work;
      const selectedEdition = work.editions.find((item) => item.id === editionId);
      if (selectedEdition) match = { work, edition: selectedEdition };
    } catch {
      // The record is saved; the user can find it manually if loading fails.
    }
  }
  if (context.job && !state.reviewJobs.some((item) => item.id === context.jobId))
    state.reviewJobs.unshift(context.job);
  state.selectedReviewId = context.jobId;
  state.reviewPendingEdition = match ? { jobId: context.jobId, editionId: match.edition.id } : null;
  state.reviewDetail = null;
  showView('review');
  renderReview();
  if (!match) toast('Pozycja została dodana. Wyszukaj ją w katalogu i zatwierdź.');
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
      if (!state.catalogPreview || state.catalogPreviewIsbn !== isbn) {
        const preview = await json('/api/catalog/lookup-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isbn }),
        });
        if ($('#catalogIsbn').value.trim() !== isbn) {
          $('#catalogFormMessage').textContent = 'ISBN został zmieniony. Sprawdź go ponownie.';
          return;
        }
        state.catalogPreview = preview;
        state.catalogPreviewIsbn = isbn;
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
      await restoreReviewAfterCatalog({ editionId: result.editionId, isbn });
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
  const data = await json('/api/catalog?compact=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, isbn }),
  });
  state.history = data.catalog;
  $('#catalogDialog').close();
  event.target.reset();
  await Promise.all([loadHistory(),loadCatalogData()]);
  await restoreReviewAfterCatalog({ editionId: data.editionId, isbn, title });
  renderCatalog();
  toast('Ręczny rekord katalogowy został zapisany.');
}

$('#catalogIsbn').addEventListener('input', () => {
  state.catalogPreview = null;
  state.catalogPreviewIsbn = null;
  $('#catalogSubmit').textContent = 'Sprawdź ISBN';
  $('#catalogFormMessage').hidden = true;
});

$$('.nav-item, .mobile-nav-item').forEach((button) =>
  button.addEventListener('click', () => showView(button.dataset.view)),
);
$('#scannerBrowseOffers').addEventListener('click', () => showView('offers'));
$('#scannerOfferSearch').addEventListener('input', renderScannerOffers);
$('#scannerOfferSource').addEventListener('change', renderScannerOffers);
let scannerSearchTimer;
$('#scannerOfferSearch').addEventListener('input',()=>{clearTimeout(scannerSearchTimer);scannerSearchTimer=setTimeout(()=>void refreshScannerOffers(),300);});
$('#scannerOfferSource').addEventListener('change',()=>void refreshScannerOffers());
$('#retryIdentification').addEventListener('click', async () => {
  const button = $('#retryIdentification');
  const mode = $('#retryMode').value;
  button.disabled = true;
  try {
    const result = await json('/api/identification/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    toast(result.queued > 0 ? 'Wznowiono identyfikację. Dodano do kolejki: ' + result.queued : 'Brak zadań do ponowienia w wybranej grupie. Wybierz „Wszystkie nierozstrzygnięte”.');
    await loadCatalogStatus();
    await loadCatalogData();
  } catch (error) {
    toast('Nie udało się ponowić identyfikacji: ' + error.message);
  } finally { button.disabled = false; }
});
$('#refreshView').addEventListener('click', async () => {
  if(!await confirmDiscard())return;
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
$('#cancelSearch').addEventListener('click', () => requestScanCancellation({ $, toast }));
$('#goToOffers').addEventListener('click', () => showView('offers'));
for (const selector of ['#reviewSource', '#reviewIsbn', '#reviewSort'])
  $(selector).addEventListener('change', () => scheduleGlobalCatalogSearch('jobs'));
$('#reviewSearch').addEventListener('input', () => scheduleGlobalCatalogSearch('jobs'));
$('#catalogSort').addEventListener('change', () => scheduleGlobalCatalogSearch('works'));
$('#catalogSearch').addEventListener('input', () => scheduleGlobalCatalogSearch('works'));
for (const selector of ['#offerSource', '#offerStatus', '#offerSort'])
  $(selector).addEventListener('change', () => scheduleGlobalCatalogSearch('offers'));
document.querySelectorAll('#view-offers [data-offer-sort]').forEach((button) =>
  button.addEventListener('click', () => {
    const field = $('#offerSort');
    field.value = field.value === button.dataset.offerSort
      ? button.dataset.offerSortReverse
      : button.dataset.offerSort;
    state.offerPage = 1;
    scheduleGlobalCatalogSearch('offers');
  }),
);
$('#offerSearch').addEventListener('input', () => scheduleGlobalCatalogSearch('offers'));
let identificationControlPending = false;
async function controlIdentification(action) {
  if (identificationControlPending) return;
  identificationControlPending = true;
  $('#identificationStart').disabled = true;
  $('#identificationStop').disabled = true;
  $('#identificationRunState').textContent = action === 'start' ? 'Uruchamianie…' : 'Zatrzymywanie…';
  try {
    const pending = identificationProgress(state.catalog?.identification?.statuses).pending;
    await json('/api/identification/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, retryUnresolved: action === 'start' && !pending }),
    });
    await loadCatalogStatus();
    toast(action === 'start'
      ? 'Wznowiono identyfikację.'
      : 'Zatrzymuję pobieranie nowych zadań. Rozpoczęta partia dokończy bezpieczny zapis.');
  } catch (error) {
    toast('Sterowanie identyfikacją: ' + error.message);
  } finally {
    identificationControlPending = false;
    await loadCatalogStatus();
  }
}
$('#identificationStart').addEventListener('click', () => void controlIdentification('start'));
$('#identificationStop').addEventListener('click', () => void controlIdentification('stop'));

$('#offerPrev').addEventListener('click', () => changeOfferPage(state.offerPage-1));
$('#offerNext').addEventListener('click', () => changeOfferPage(state.offerPage+1));
$('#closeOfferDrawer').addEventListener('click', () => offersView.closeOfferDrawer());
$('#openCatalogForm').addEventListener('click', () => {
  state.catalogReturnToReview = null;
  $('#catalogDialog').showModal();
  setCatalogMode('isbn');
});
$('#closeCatalogForm').addEventListener('click', () => { state.catalogReturnToReview = null; $('#catalogDialog').close(); });
$('#cancelCatalogForm').addEventListener('click', () => { state.catalogReturnToReview = null; $('#catalogDialog').close(); });
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
      $('#scanGuardMessage').textContent = 'Skan działa na serwerze także po zamknięciu karty. Możesz go anulować.';
      $('#cancelSearch').hidden = false;
      $('#cancelSearch').disabled = false;
    } else if (status.status === 'cancelled') {
      $('#scanStateBadge').textContent = 'Skan anulowany';
      $('#scanStateBadge').className = 'state-badge neutral';
      $('#cancelSearch').hidden = true;
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

const scanInsights = createScanInsights({ $, json, escapeHtml });
const setsView = createSetsView({ $, json, escapeHtml, toast, openOfferDrawer, onSelect: () => syncItemUrl() });
// Review: one scrolling list, no separate page-level loading controls.
let reviewScrollLoading = false;
$('#reviewList').addEventListener('scroll', async (event) => {
  const list = event.currentTarget;
  if (reviewScrollLoading || state.activeView !== 'review') return;
  if (list.scrollTop + list.clientHeight < list.scrollHeight - 180) return;
  reviewScrollLoading = true;
  try {
    if ((state.visibleRows.jobs || 100) < state.reviewJobs.length) {
      state.visibleRows.jobs = Math.min(state.visibleRows.jobs + 100, state.reviewJobs.length);
      renderReview();
    } else if (state.catalogPages.jobs.offset < state.catalogPages.jobs.total) {
      const loaded = await loadCatalogPage('jobs');
      if (loaded) {
        state.visibleRows.jobs += 100;
        renderReview();
      }
    }
  } catch (error) {
    toast('Nie udało się wczytać dalszych ofert: ' + error.message);
  } finally {
    reviewScrollLoading = false;
  }
});

const reviewView = createReviewView({ state, $, $$, json, toast, money, date, escapeHtml, reviewOffers, loadCatalogData, renderCatalog, openCatalogForReview });
const catalogView = createCatalogView({ state, $, $$, json, money, escapeHtml, visibleCatalogRows, openOfferDrawer, loadCatalogData });
mountDuplicates({ $, json, escapeHtml, toast, loadCatalogData });
const onFiltersChange = () => void changeOfferPage(state.offerPage);
const offersView = createOffersView({ state, $, $$, json, money, date, escapeHtml, allOffers, bookFor, showView, priceStats, onFiltersChange });

async function changeOfferPage(page) {
  if(page<1 || page>Math.max(1,Math.ceil(state.catalogPages.offers.total/state.pageSize))) return;
  try { if(await loadCatalogPage('offers',{reset:true,pageNumber:page})) renderOffers(); }
  catch(error) {toast('Nie udało się zmienić strony: '+error.message);}
}
const tradingControls = installTradingControls({state,$,json,toast,showView,loadCatalogData,loadCatalogStatus,openOfferDrawer,
  onOfferFilters:()=>scheduleGlobalCatalogSearch('offers'),onCatalogFilters:()=>scheduleGlobalCatalogSearch('works')});
const refreshWorkflowDashboard = installDashboard({ state, showView });
const startupView = viewFromSearch(location.search);
const startupItem = idFromSearch(location.search);
showView(startupView);
Promise.all([loadSources().then(() => installScanProfiles({ queriesInput: $('#queries'), sourceGrid: $('#sourceGrid'), panel: $('.scanner-form-panel'), toast, json }).then(() => mountScanSchedule({ panel: $('.scanner-form-panel'), json, toast, escapeHtml }))), loadHistory(), loadCatalogStatus(), loadCatalogData(), restoreLastScanStatus(), tradingControls.refreshRuns()]).catch(
  (error) => {
    $('#connectionLabel').textContent = 'Błąd połączenia';
    toast(`Nie udało się wczytać aplikacji: ${error.message}`);
  },
).then(async () => {
  await restoreItem(startupView, startupItem);
  itemUrlReady = true;
  syncItemUrl();
});

let identificationRefreshBusy = false;
let lastCatalogDataRefresh = 0;
setInterval(async () => {
  if (identificationRefreshBusy || document.hidden || state.scan.running) return;
  identificationRefreshBusy = true;
  try {
    await loadCatalogStatus();
    if (['review'].includes(state.activeView) &&
      !(state.activeView === 'review' && state.selectedReviewId) &&
      Date.now() - lastCatalogDataRefresh >= 12000) {
      lastCatalogDataRefresh = Date.now();
      await loadCatalogData();
    }
  } catch {
    // Preserve current UI; manual refresh still reports connection failures.
  } finally {
    identificationRefreshBusy = false;
  }
}, 4000);

// Live diagnostics are read-only and do not interfere with scan streaming.
void scanInsights.refresh();
setInterval(() => { if (!document.hidden) void scanInsights.refresh(); }, 3000);

installDetailNavigation();
installCoverFallback();
installPreferences({
  $, $$,
  onTradingChange: () => { renderOffers(); },
  onCatalogViewChange: () => renderCatalog(),
});
$('#catalogIncompleteOnly')?.addEventListener('change', () => renderCatalog());
installCommandPalette({
  $, json, escapeHtml, money, showView, openOfferDrawer,
  openWork: (id) => { if (showView('catalog')) void catalogView.openCatalogDetail(id); },
  actions: [
    { label: 'Rozpocznij skan', hint: 'Frazy i źródła z formularza skanera', run: () => { showView('scanner'); $('#startSearch')?.click(); } },
    { label: 'Następna oferta do weryfikacji', hint: 'Otwiera kolejkę na pierwszej pozycji', run: () => { showView('review'); document.querySelector('#reviewList [data-review-id]')?.click(); } },
    { label: 'Dodaj książkę do katalogu', hint: 'Przez ISBN albo ręcznie', run: () => $('#openCatalogForm')?.click() },
    { label: 'Utwórz kopię zapasową', hint: 'Ustawienia → Dane i kopie zapasowe', run: () => { showView('settings'); $('#createBackup')?.focus(); } },
    { label: 'Przełącz motyw', hint: 'Jasny / ciemny / systemowy', run: () => { const select = $('#prefTheme'); select.value = select.value === 'dark' ? 'light' : 'dark'; select.dispatchEvent(new Event('change')); } },
  ],
});

document.addEventListener('bookflip-open-edition', event => {
  if (!event.detail?.editionId) return;
  showView('catalog');
  if ($('#catalogDetail').dataset.editionId === event.detail.editionId) openDetailView('catalog');
  else void catalogView.openEditionDetail(event.detail.editionId);
});
