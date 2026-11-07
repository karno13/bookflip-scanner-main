import { mountEditionHistory } from './edition-history.js';
import { mountEditionBuyback, annotateEditionLines } from './buyback.js';
import { openDetailView } from '../core/detail-navigation.js';
import {markDirty,statusLabel,confirmDiscard,watchForm} from '../core/ux.js';
import { safeOfferHref } from '../core/formatters.js';
import { mountSeriesEditor, readSeries, seriesSummary } from './series.js';
import { confirmDialog } from '../core/dialogs.js';
import { coverMarkup, isbnCover, tidyWorkTitle, parseBnPeople, splitBnTitle, cleanPublisher } from '../core/bibliography.js';

const firstIsbn = (editions = []) =>
  editions.flatMap((edition) => edition.identifiers || []).find((item) => String(item.scheme).startsWith('isbn'))?.value;
const workCover = (work) => work.cover || (work.editions || []).find((edition) => edition.cover)?.cover || isbnCover(firstIsbn(work.editions));
const workAuthors = (work) => parseBnPeople((work.authors || []).join(' '), work.authors).join(', ');
// What is still missing in a work record — shown as chips and used by the "incomplete" filter.
function missingFacts(work) {
  const editions = work.editions || [];
  const missing = [];
  if (editions.some((edition) => !edition.publicationYear)) missing.push('rok');
  if (editions.some((edition) => !edition.publisher)) missing.push('wydawca');
  if (!firstIsbn(editions)) missing.push('ISBN');
  return missing;
}
// catalog workspace, preserving existing behavior while isolating its implementation.
export function createCatalogView({ state, $, $$, json, money, escapeHtml, visibleCatalogRows, openOfferDrawer, loadCatalogData, toast, showView }) {
function catalogRows() {
  // Preserve the ordering and full-dataset filters returned by the server.
  return [...state.catalogWorks];
}

function validCoverIsbn(value) {
  const isbn = String(value || '')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
  if (/^\d{13}$/.test(isbn))
    return [...isbn].reduce((sum, d, i) => sum + Number(d) * (i % 2 ? 3 : 1), 0) % 10 === 0
      ? isbn
      : null;
  if (/^\d{9}[0-9X]$/.test(isbn))
    return [...isbn].reduce((sum, d, i) => sum + (10 - i) * (d === 'X' ? 10 : Number(d)), 0) %
      11 ===
      0
      ? isbn
      : null;
  return null;
}
function pluralForm(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (n === 1) return 'one';
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'few' : 'many';
}

function coverPreviewMarkup(identifiers = []) {
  const isbn = identifiers.map((item) => validCoverIsbn(item.value)).find(Boolean);
  const cover = isbn
    ? `<img class="cover-preview-image" src="https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '';
  return `<span class="cover-preview"><span class="book-spine" aria-hidden="true">▤</span>${cover}</span>`;
}
document.addEventListener(
  'load',
  (event) => {
    if (
      event.target instanceof HTMLImageElement &&
      event.target.classList.contains('cover-preview-image') &&
      event.target.naturalWidth > 1
    )
      event.target.closest('.cover-preview')?.classList.add('has-cover');
  },
  true,
);

let detailRequest = 0;
let sqliteAnnotations = null;
let seriesRequest = null;
async function loadSeries() {
  if (seriesRequest) return seriesRequest;
  seriesRequest = json('/api/catalog/series').then(response => {
    sqliteAnnotations = Object.fromEntries((response.items || []).map(item => [item.workId, { series: item.series, volume: item.volume }]));
    renderSeriesSummary();
  }).finally(() => { seriesRequest = null; });
  return seriesRequest;
}
async function saveSeries(workId, entry) {
  const saved = await json('/api/catalog/series/' + encodeURIComponent(workId), {
    method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(entry)
  });
  if (!sqliteAnnotations) sqliteAnnotations = {};
  if (!saved.series) delete sqliteAnnotations[workId];
  else sqliteAnnotations[workId] = {series: saved.series, volume: saved.volume};
  seriesTree = null;
  return saved;
}
function renderEditionRail(work, selectedId = null) {
  const panel = $('#catalogEditionsPanel');
  if (!panel) return;
  panel.dataset.workId = work.id;
  panel.innerHTML = '<div class="edition-rail-heading">Wydania · ' + work.editions.length + '</div><div class="edition-rail-book">' + escapeHtml(work.title) + '</div>' + work.editions.map(edition => '<button type="button" class="edition-rail-row' + (edition.id === selectedId ? ' active' : '') + '" data-rail-edition="' + escapeHtml(edition.id) + '" aria-pressed="' + (edition.id === selectedId) + '"><strong>' + escapeHtml(edition.title) + '</strong><small>' + escapeHtml([edition.publisher, edition.publicationYear, edition.language, edition.binding].filter(Boolean).join(' · ') || 'Brak danych bibliograficznych') + '</small><span class="rail-isbn">' + escapeHtml(edition.identifiers.find(item => item.scheme.startsWith('isbn'))?.value || 'Brak ISBN') + '</span></button>').join('');
  panel.querySelectorAll('[data-rail-edition]').forEach(button => button.addEventListener('click', () => openEditionDetail(button.dataset.railEdition)));
}

function queryEmptyMarkup() {
  const filtered=['#catalogSearch','#catalogLanguage','#catalogPublisher','#catalogYear','#catalogBinding'].some(id=>$(id)?.value.trim());
  return filtered ? '<div class="empty-detail"><h3>Brak pasujących książek</h3><p>Zmień frazę lub usuń filtry wydań.</p></div>' : '<div class="empty-detail"><h3>Katalog jest pusty</h3><p>Zeskanuj oferty lub dodaj pierwszą książkę.</p></div>';
}
function renderCatalog() {
  if (!state.history) return;
  renderSeriesSummary();
  if (sqliteAnnotations === null && !seriesRequest) void loadSeries().catch(() => {});
  const seriesMode = document.body.dataset.catalogView === 'series';
  $('#catalogList').classList.toggle('is-series', seriesMode);
  if (seriesMode) {
    $('#catalogList').classList.remove('is-grid');
    void renderSeriesTree();
    return;
  }
  const onlyIncomplete = $('#catalogIncompleteOnly')?.checked;
  const rows = catalogRows().filter((row) => !onlyIncomplete || missingFacts(row).length);
  $('#catalogList').classList.toggle('is-grid', document.body.dataset.catalogView === 'grid');
  $('#catalogList').innerHTML = rows.length
    ? visibleCatalogRows('works', rows)
        .map(
          (row) =>
            catalogRowMarkup(row),
        )
        .join('')
    : queryEmptyMarkup();
  $$('[data-catalog-id]').forEach((button) =>
    button.addEventListener('click', () => openCatalogDetail(button.dataset.catalogId)),
  );
}

// Series view: universe → cycle → volumes on a shelf, with dashed placeholders for missing volumes.
let seriesTree = null;
let seriesTreeAt = 0;
let seriesTreeRequest = null;
async function loadSeriesTree(force = false) {
  if (!force && seriesTree && Date.now() - seriesTreeAt < 30000) return seriesTree;
  seriesTreeRequest ??= json('/api/catalog/series-tree')
    .then((data) => {
      seriesTree = data.universes || [];
      seriesTreeAt = Date.now();
      return seriesTree;
    })
    .finally(() => {
      seriesTreeRequest = null;
    });
  return seriesTreeRequest;
}
const foldText = (text) => String(text ?? '').toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
const offersLabel = (n) => `${n} ${n === 1 ? 'oferta' : pluralForm(n) === 'few' ? 'oferty' : 'ofert'}`;
const collapsedUniverses = new Set();
// Cycles with gaps, by index, for the "find missing" buttons of the current render.
let missingTargets = [];
const MAX_SCAN_QUERIES = 10;

function missingQueries(target) {
  return target.missing.slice(0, MAX_SCAN_QUERIES).map((number) => `${target.name} tom ${number}`);
}

function missingListText(targets) {
  return targets
    .map((target) => `${target.universe === target.name ? target.name : `${target.universe} — ${target.name}`}: tomy ${target.missing.join(', ')}`)
    .join('\n');
}

function findMissing(target) {
  const queries = missingQueries(target);
  const field = $('#queries');
  if (!field || !queries.length) return;
  field.value = queries.join('\n');
  field.dispatchEvent(new Event('input', { bubbles: true }));
  showView('scanner');
  field.focus();
  toast(
    target.missing.length > MAX_SCAN_QUERIES
      ? `Wpisano frazy dla ${MAX_SCAN_QUERIES} z ${target.missing.length} brakujących tomów (limit skanu). Wybierz źródła i uruchom skan.`
      : `Wpisano ${queries.length} ${queries.length === 1 ? 'frazę' : pluralForm(queries.length) === 'few' ? 'frazy' : 'fraz'} dla brakujących tomów. Wybierz źródła i uruchom skan.`,
  );
}

function shelfBookMarkup(work) {
  const title = tidyWorkTitle(work.title);
  return `<button type="button" class="shelf-book${work.id === state.selectedCatalogId ? ' active' : ''}" data-series-work="${escapeHtml(work.id)}" title="${escapeHtml(work.title)}">${coverMarkup(work.cover, title, { size: 'lg', escapeHtml })}${work.volume ? `<span class="shelf-vol">${work.volume}</span>` : ''}<b>${escapeHtml(title)}</b><small>${escapeHtml([work.firstYear, offersLabel(work.offers)].filter(Boolean).join(' · '))}</small></button>`;
}

function cycleMarkup(cycle, universe, onlyCycle) {
  // Placeholders only where the gap is readable; long gaps (Świat Dysku 1…41) get a summary line.
  const showGhosts = cycle.missing.length && cycle.missing.length <= 12;
  const items = [];
  if (showGhosts) {
    const missing = new Set(cycle.missing);
    const byVolume = cycle.works.filter((work) => Number.isInteger(work.volume));
    const last = cycle.volumes.at(-1) || 0;
    for (let number = 1; number <= last; number++) {
      if (missing.has(number)) items.push(`<span class="shelf-book is-missing" aria-label="Brak tomu ${number}"><span class="shelf-ghost">${number}</span><small>brak w katalogu</small></span>`);
      else for (const work of byVolume.filter((item) => item.volume === number)) items.push(shelfBookMarkup(work));
    }
    for (const work of cycle.works.filter((item) => !Number.isInteger(item.volume))) items.push(shelfBookMarkup(work));
  } else items.push(...cycle.works.map(shelfBookMarkup));
  const facts = [
    cycle.volumes.length ? `tomy ${cycle.volumes.join(', ')}` : '',
    cycle.missing.length ? (showGhosts ? `brakuje ${cycle.missing.length}` : `brakuje ${cycle.missing.length} tomów do ${cycle.volumes.at(-1)}`) : '',
    `${cycle.works.length} ${cycle.works.length === 1 ? 'dzieło' : pluralForm(cycle.works.length) === 'few' ? 'dzieła' : 'dzieł'}`,
  ].filter(Boolean);
  const name = cycle.name || (onlyCycle ? universe : 'Pozostałe');
  // Unnamed cycles carry the universe's own numbering ("Discworld series t. 14").
  const searchName = cycle.name || universe;
  let finder = '';
  if (cycle.missing.length) {
    missingTargets.push({ name: searchName, universe, missing: cycle.missing });
    finder = `<button class="button ghost compact series-find" type="button" data-find-missing="${missingTargets.length - 1}" title="Wpisz do skanera frazy „${escapeHtml(searchName)} tom N” dla brakujących tomów">Szukaj brakujących</button>`;
  }
  return `<div class="series-cycle${cycle.name ? '' : ' is-loose'}"><div class="series-cycle-head"><h4>${escapeHtml(name)}</h4><small>${escapeHtml(facts.join(' · '))}</small>${finder}</div><div class="series-shelf">${items.join('')}</div></div>`;
}

async function renderSeriesTree() {
  const list = $('#catalogList');
  if (!seriesTree) list.innerHTML = '<p class="inline-note">Układanie serii…</p>';
  let universes;
  try {
    universes = await loadSeriesTree();
  } catch {
    list.innerHTML = '<p class="inline-note">Nie udało się odczytać serii.</p>';
    return;
  }
  if (document.body.dataset.catalogView !== 'series') return;
  const needle = foldText($('#catalogSearch')?.value.trim() || '');
  const visible = universes
    .map((universe) => {
      const universeHit = needle && foldText(universe.name).includes(needle);
      const cycles = universe.cycles
        .map((cycle) => {
          if (!needle || universeHit || foldText(cycle.name || '').includes(needle)) return cycle;
          const works = cycle.works.filter((work) => foldText(work.title).includes(needle));
          return works.length ? { ...cycle, works, missing: [] } : null;
        })
        .filter(Boolean);
      return cycles.length ? { ...universe, cycles } : null;
    })
    .filter(Boolean);
  missingTargets = [];
  const universeMarkup = visible
    .map((universe) => {
      const named = universe.cycles.filter((cycle) => cycle.name).length;
      return `<details class="series-universe" id="series-${escapeHtml(foldText(universe.name).replace(/[^a-z0-9]+/g, '-'))}" data-universe="${escapeHtml(universe.name)}"${collapsedUniverses.has(universe.name) ? '' : ' open'}><summary><h3>${escapeHtml(universe.name)}</h3><small>${universe.works} dzieł · ${offersLabel(universe.offers)}${named ? ` · cykle: ${named}` : ''}</small></summary>${universe.cycles.map((cycle) => cycleMarkup(cycle, universe.name, universe.cycles.length === 1)).join('')}</details>`;
    })
    .join('');
  const missingTotal = missingTargets.reduce((sum, target) => sum + target.missing.length, 0);
  const gapsBar = missingTotal
    ? `<div class="series-gaps"><span><b>Braki w seriach: ${missingTotal}</b> ${missingTotal === 1 ? 'tom' : pluralForm(missingTotal) === 'few' ? 'tomy' : 'tomów'} w ${missingTargets.length} ${missingTargets.length === 1 ? 'cyklu' : 'cyklach'}</span><button class="button ghost compact" type="button" id="copySeriesGaps">Kopiuj listę braków</button></div>`
    : '';
  list.innerHTML = visible.length
    ? gapsBar + `<nav class="series-jump" aria-label="Uniwersa">${visible.map((universe) => `<a href="#series-${escapeHtml(foldText(universe.name).replace(/[^a-z0-9]+/g, '-'))}">${escapeHtml(universe.name)} <small>${universe.works}</small></a>`).join('')}</nav>` + universeMarkup
    : queryEmptyMarkup();
  list.querySelectorAll('[data-find-missing]').forEach((button) =>
    button.addEventListener('click', () => findMissing(missingTargets[Number(button.dataset.findMissing)])),
  );
  $('#copySeriesGaps')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(missingListText(missingTargets));
      toast('Skopiowano listę brakujących tomów.');
    } catch {
      toast('Schowek jest niedostępny w tej przeglądarce.');
    }
  });
  list.querySelectorAll('[data-series-work]').forEach((button) =>
    button.addEventListener('click', () => openCatalogDetail(button.dataset.seriesWork)),
  );
  list.querySelectorAll('details.series-universe').forEach((details) =>
    details.addEventListener('toggle', () => {
      if (details.open) collapsedUniverses.delete(details.dataset.universe);
      else collapsedUniverses.add(details.dataset.universe);
    }),
  );
}

function catalogRowMarkup(row) {
  const title = tidyWorkTitle(row.title);
  const parts = splitBnTitle(row.title);
  const single = row.editionCount === 1 ? row.editions[0] : null;
  const meta = single
    ? [cleanPublisher(single.publisher), single.publicationYear].filter(Boolean).join(' · ') || 'Brak danych wydania'
    : `${row.editionCount} wydań`;
  const missing = missingFacts(row);
  return `<button class="catalog-row work-row ${row.id === state.selectedCatalogId ? 'active' : ''}" type="button" data-catalog-id="${escapeHtml(row.id)}" title="${escapeHtml(row.title)}"><span class="catalog-book-title">${coverMarkup(workCover(row), title, { size: 'md', escapeHtml })}<span class="catalog-book-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(workAuthors(row) || 'Autor nieznany')}</small><small class="work-meta">${escapeHtml(meta)}${parts.series ? ` · ${escapeHtml(parts.series)}${parts.volume ? ' ' + parts.volume : ''}` : ''}</small>${missing.length ? `<small class="missing-facts">${missing.map((item) => `<span>brak: ${escapeHtml(item)}</span>`).join('')}</small>` : ''}</span></span><span>${row.editionCount}</span><span data-plural="${pluralForm(row.offerCount)}">${row.offerCount}</span><span><span class="status-pill ${['manual', 'verified'].includes(row.verificationStatus) ? 'success' : 'warning'}">${escapeHtml(statusLabel(row.verificationStatus))}</span></span></button>`;
}

function renderSeriesSummary() {
  const anchor = $('#catalogList');
  if (!anchor) return;
  let panel = $('#catalogSeriesSummary');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'catalogSeriesSummary';
    panel.className = 'series-summary panel';
    document.querySelector('#legacyImportActions').append(panel);
  }
  const groups = seriesSummary(state.catalogWorks, sqliteAnnotations || {});
  panel.replaceChildren();
  const label = document.createElement('strong');
  label.textContent = 'Import oznaczeń serii ze starszej wersji';
  panel.append(label);
  const info = document.createElement('p');
  info.textContent = sqliteAnnotations === null ? 'Ładowanie serii z SQLite…' : groups.length ? groups.map(group => `${group.name}: tomy ${group.volumes.join(', ')}`).join(' | ') : 'Wybierz dzieło, aby przypisać serię i numer tomu.';
  panel.append(info);
  const legacy = readSeries();
  const pending = Object.entries(legacy).filter(([workId, entry]) =>
    entry && typeof entry.series === 'string' && entry.series.trim() &&
    Number.isSafeInteger(entry.volume) && entry.volume > 0 && entry.volume <= 10000 &&
    sqliteAnnotations && !Object.hasOwn(sqliteAnnotations, workId));
  panel.hidden = pending.length === 0;
  if (sqliteAnnotations !== null && pending.length) {
    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.className = 'button secondary compact';
    importButton.textContent = 'Importuj lokalne oznaczenia (' + pending.length + ')';
    const result = document.createElement('small');
    result.setAttribute('role', 'status');
    importButton.addEventListener('click', async () => {
      if (!(await confirmDialog('Importować ' + pending.length + ' lokalnych oznaczeń do SQLite? Istniejące wpisy zostaną pominięte.', { title: 'Import oznaczeń', confirmLabel: 'Importuj' }))) return;
      importButton.disabled = true;
      let imported = 0, skipped = 0, errors = 0;
      for (const [workId, entry] of pending) {
        try {
          const current = await json('/api/catalog/series');
          const existing = new Set((current.items || []).map(row => row.workId));
          if (existing.has(workId)) { skipped++; continue; }
          await saveSeries(workId, { series: entry.series.trim(), volume: entry.volume });
          imported++;
        } catch { errors++; }
      }
      result.textContent = 'Zaimportowano: ' + imported + ', pominięto: ' + skipped + ', błędy: ' + errors + '. Dane lokalne zachowano.';
      renderSeriesSummary();
    });
    panel.append(importButton, result);
  }
}

async function openCatalogDetail(id) {
  if(!await confirmDiscard()) return;
  const request = ++detailRequest;
  state.selectedCatalogId = id;
  openDetailView('catalog');
  renderCatalog();
  const detail = $('#catalogDetail');
  delete detail.dataset.editionId;
  detail.innerHTML = '<div class="empty-detail"><p>Wczytywanie rekordu...</p></div>';
  try {
    const row = await json(`/api/catalog/works/${encodeURIComponent(id)}`);
    if (request !== detailRequest) return;
    renderEditionRail(row);
    detail.scrollTop = 0;
    detail.innerHTML = `<section class="detail-section"><div class="book-detail-title work-hero">${coverMarkup(workCover(row), tidyWorkTitle(row.title), { size: 'lg', escapeHtml })}<div><span class="status-pill ${['manual', 'verified'].includes(row.verificationStatus) ? 'success' : 'warning'}">${escapeHtml(statusLabel(row.verificationStatus))}</span><h3 title="${escapeHtml(row.title)}">${escapeHtml(tidyWorkTitle(row.title))}</h3><p>${escapeHtml(workAuthors(row) || 'Autor nieznany')}</p></div><strong>${row.editions.length} wydań</strong></div></section><section class="detail-section"><h4>Wydania — wybierz, aby zobaczyć oferty i ceny</h4><div class="price-list">${row.editions.map((edition) => `<button type="button" class="link-button edition-line" data-edition-detail="${escapeHtml(edition.id)}">${coverMarkup(edition.cover || isbnCover(firstIsbn([edition])), edition.title, { size: 'xs', escapeHtml })}<span><strong>${escapeHtml(edition.title)}</strong><small>${escapeHtml([edition.publisher, edition.publicationYear, edition.language].filter(Boolean).join(' / ') || 'Brak szczegółów')}</small></span><b>${escapeHtml(edition.identifiers.find((item) => item.scheme.startsWith('isbn'))?.value || 'bez ISBN')}</b></button>`).join('') || '<p>Brak wydań.</p>'}</div></section><details class="detail-section"><summary>Pochodzenie danych bibliograficznych</summary><p class="inline-note">${row.externalRecords.length ? row.externalRecords.map((record) => `${escapeHtml(record.provider)}: ${escapeHtml(record.externalId)}`).join(', ') : 'Brak zewnętrznych rekordów bibliograficznych.'}</p></section>`;
    try { await loadSeries(); } catch (error) { /* Edytor pokaże błąd zapisu, jeśli baza jest niedostępna. */ }
    if (request !== detailRequest) return;
    mountWorkActions(row,detail);
    mountSeriesEditor(row, detail, renderSeriesSummary, { annotations: sqliteAnnotations || {}, save: saveSeries });
    void mountUniverseEditor(row, detail);
    void annotateEditionLines(row, detail);
    detail.querySelectorAll('[data-edition-detail]').forEach((button) =>
      button.addEventListener('click', () => openEditionDetail(button.dataset.editionDetail)),
    );
  } catch (error) {
    if (request !== detailRequest) return;
    detail.innerHTML = `<div class="empty-detail"><h3>Nie udalo sie wczytac rekordu</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

// Which universe shelf a work sits on in the series view. Automatic by default (title words, then
// the scan phrase); the operator can move a stray work ("Logik der Forschung" under Warcraft).
async function mountUniverseEditor(row, detail) {
  let universes = [];
  try {
    universes = await loadSeriesTree();
  } catch {
    return;
  }
  if (!detail.isConnected || state.selectedCatalogId !== row.id) return;
  const current = universes.find((universe) => universe.cycles.some((cycle) => cycle.works.some((work) => work.id === row.id)));
  const manual = current?.cycles.some((cycle) => cycle.works.some((work) => work.id === row.id && work.universeManual));
  const names = [...new Set([...universes.map((universe) => universe.name), 'Poza seriami'])];
  const section = document.createElement('section');
  section.className = 'detail-section universe-editor';
  section.innerHTML = `<h4>Uniwersum w widoku „Serie”</h4><p class="inline-note">Teraz: <b>${escapeHtml(current?.name || 'Poza seriami')}</b> ${manual ? '(wybrane ręcznie)' : '(automatycznie: tytuł albo fraza skanu)'}</p><div class="universe-editor-row"><select aria-label="Uniwersum dzieła"><option value="">Automatycznie</option>${names.map((name) => `<option value="${escapeHtml(name)}"${manual && name === current?.name ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select><button type="button" class="button secondary">Zapisz uniwersum</button></div>`;
  detail.append(section);
  const select = section.querySelector('select');
  const button = section.querySelector('button');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await json('/api/catalog/universe/' + encodeURIComponent(row.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universe: select.value || null }),
      });
      seriesTree = null;
      toast(select.value ? `Przeniesiono do „${select.value}”.` : 'Przywrócono automatyczne uniwersum.');
      if (document.body.dataset.catalogView === 'series') void renderSeriesTree();
      section.remove();
      void mountUniverseEditor(row, detail);
    void annotateEditionLines(row, detail);
    } catch (error) {
      toast('Nie zapisano uniwersum: ' + error.message);
      button.disabled = false;
    }
  });
}

function priceStats(prices) {
  const sorted = prices
    .filter(value=>value!==null&&value!==undefined)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
  };
}
function offerPriceSummary(offers = []) {
  return priceStats(offers.filter(item=>item.availability!=='unavailable' && (!item.currency || item.currency==='PLN')).map((item) => item.currentPrice));
}
function offerPriceSummaryMarkup(offers = []) {
  const stats = offerPriceSummary(offers);
  if (!stats) return '<p class="inline-note">Brak zapisanych cen ofertowych dla tego wydania.</p>';
  return `<div class="edition-price-summary"><div><small>Mediana cen ofertowych</small><strong>${money(stats.median)}</strong></div><div><small>Najniższa oferta</small><strong>${money(stats.min)}</strong></div><div><small>Liczba cen</small><strong>${stats.count}</strong></div></div><p class="inline-note">Wartości na podstawie aktualnych cen zapisanych ofert. Nie są to ceny sprzedaży ani prognoza zysku; nie uwzględniają kosztów dostawy i stanu egzemplarza.</p>`;
}

async function openEditionDetail(id) {
  if(!await confirmDiscard())return;
  const request = ++detailRequest;
  openDetailView('catalog');
  const detail = $('#catalogDetail');
  detail.innerHTML = '<div class="empty-detail"><p>Wczytywanie wydania...</p></div>';
  try {
    const row = await json(`/api/catalog/editions/${encodeURIComponent(id)}`);
    if (request !== detailRequest) return;
    state.selectedCatalogId = row.workId;
    renderCatalog();
    detail.dataset.editionId = id;
    detail.scrollTop = 0;
    const rail = $('#catalogEditionsPanel');
    if (rail?.dataset.workId === row.workId) {
      rail.querySelectorAll('[data-rail-edition]').forEach(button => {
        const active = button.dataset.railEdition === id;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    } else if (rail) {
      rail.replaceChildren();
      void json('/api/catalog/works/' + encodeURIComponent(row.workId)).then(work => {
        if (request === detailRequest) renderEditionRail(work, id);
      }).catch(() => { if (request === detailRequest) rail.textContent = 'Nie udało się odczytać listy wydań.'; });
    }
    detail.innerHTML = `<section class="detail-section"><button class="link-button" id="backToWork" type="button">← Wróć do dzieła</button><div class="edition-identity">${row.cover ? coverMarkup(row.cover, row.title, { size: 'lg', escapeHtml }) : coverPreviewMarkup(row.identifiers)}<div><h3>${escapeHtml(row.title)}</h3><p class="inline-note">${escapeHtml(row.authors?.join(', ') || 'Autor nieznany')}</p></div></div><div class="detail-grid"><span><b>ISBN</b><small>${escapeHtml(
      row.identifiers
        .filter((item) => item.scheme.startsWith('isbn'))
        .map((item) => item.value)
        .join(', ') || 'brak',
    )}</small></span><span><b>Wydawca</b><small>${escapeHtml(row.publisher || '-')}</small></span><span><b>Rok</b><small>${escapeHtml(row.publicationYear || '-')}</small></span><span><b>Język / oprawa</b><small>${escapeHtml([row.language, row.binding].filter(Boolean).join(' / ') || '-')}</small></span></div></section><section class="detail-section"><h4>Ceny zapisanych ofert</h4>${offerPriceSummaryMarkup(row.offers)}</section><section class="detail-section"><h4>Powiązane oferty</h4><div class="price-list">${row.offers.map((item) => `<button class="link-button" type="button" data-edition-offer="${escapeHtml(item.id)}"><span>${escapeHtml(item.title)}<small>${escapeHtml(item.source)} · wykryto ${escapeHtml(item.lastSeenAt || 'brak daty')} · ${escapeHtml(item.availability==='unavailable'?'niedostępna':'dostępność niepotwierdzona')}</small></span><b>${money(item.currentPrice)}</b></button>`).join('') || '<p>Brak ofert.</p>'}</div></section>`;
    detail.querySelectorAll('[data-edition-offer]').forEach(button=>button.addEventListener('click',()=>openOfferDrawer(button.dataset.editionOffer)));
    const history = mountEditionHistory({ row, target: detail, json, money, openOfferDrawer });
    detail.querySelectorAll('.detail-section')[2].before(history);
    mountEditionBuyback({ row, target: detail, toast });
    mountEditionActions(row,detail);
    $('#backToWork').addEventListener('click', () => openCatalogDetail(row.workId));
  } catch (error) {
    if (request !== detailRequest) return;
    detail.innerHTML = `<div class="empty-detail"><p>${escapeHtml(error.message)}</p></div>`;
  }
}


function editorField(form,label,name,value='',type='text') {
  const field=document.createElement('label');field.className='field';const copy=document.createElement('span');copy.textContent=label;
  const input=document.createElement('input');Object.assign(input,{name,type,value:value??''});field.append(copy,input);form.append(field);return input;
}
function mountWorkActions(row,detail) {
  const root=document.createElement('details');root.className='catalog-edit';const summary=document.createElement('summary');summary.textContent='Popraw dane dzieła / połącz duplikat';root.append(summary);
  const form=document.createElement('form');const title=editorField(form,'Tytuł dzieła','title',row.title),authors=editorField(form,'Autorzy (oddziel średnikiem)','authors',row.authors.join('; '));
  const save=document.createElement('button');save.type='submit';save.className='button secondary';save.textContent='Zapisz poprawione dane';
  const message=document.createElement('p');message.setAttribute('role','status');form.append(save,message);root.append(form);
  const savedWork=watchForm('catalog-work',[title,authors]);
  form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;try{await json('/api/catalog/works/'+encodeURIComponent(row.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:title.value,authors:authors.value.split(';').map(value=>value.trim()).filter(Boolean)})});savedWork();await loadCatalogData();await openCatalogDetail(row.id);}catch(error){message.textContent='Nie zapisano. Sprawdź tytuł i autorów.';}finally{save.disabled=false;}});
  const query=editorField(root,'Znajdź docelowe dzieło dla duplikatu','mergeQuery');const search=document.createElement('button');search.type='button';search.className='button secondary';search.textContent='Znajdź dzieło';const choices=document.createElement('div');root.append(search,choices);
  search.addEventListener('click',async()=>{
    if(query.value.trim().length<2) {message.textContent='Wpisz co najmniej dwa znaki.';return;}
    search.disabled=true;
    try{const result=await json('/api/catalog/works?'+new URLSearchParams({query:query.value,limit:'30'}));choices.replaceChildren();
    for(const target of result.items.filter(item=>item.id!==row.id)){
      const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent='Połącz z: '+target.title+' · '+target.editionCount+' wydań';choices.append(button);
      button.addEventListener('click',async()=>{button.disabled=true;try{const payload={sourceId:row.id,targetId:target.id};const preview=await json('/api/catalog/merge-works',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!(await confirmDialog('Przenieść '+preview.editions+' wydań z „'+preview.sourceTitle+'” do „'+preview.targetTitle+'”? Dane docelowego dzieła pozostaną. Historyczne decyzje zostaną zachowane.', { title: 'Łączenie dzieł', confirmLabel: 'Połącz', danger: true }))) return;
        await json('/api/catalog/merge-works',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,confirm:true})});await loadCatalogData();await openCatalogDetail(target.id);
      }catch(error){message.textContent='Nie połączono: konflikt serii, chronione identyfikatory lub rekord już połączony. Żadne częściowe zmiany nie zostały zapisane.';}finally{button.disabled=false;}});
    }
    if(!choices.children.length)choices.textContent='Brak innych dzieł. Zmień frazę.';
    }catch(error){message.textContent='Nie udało się wyszukać duplikatów.';}finally{search.disabled=false;}
  });detail.append(root);
}
function mountEditionActions(row,detail) {
  const root=document.createElement('details');root.className='catalog-edit';const summary=document.createElement('summary');summary.textContent='Popraw dane wydania';root.append(summary);
  const form=document.createElement('form');const fields={title:editorField(form,'Tytuł','title',row.title),publisher:editorField(form,'Wydawca','publisher',row.publisher),publicationYear:editorField(form,'Rok','year',row.publicationYear,'number'),language:editorField(form,'Język','language',row.language),binding:editorField(form,'Oprawa','binding',row.binding)};
  const save=document.createElement('button');save.type='submit';save.className='button secondary';save.textContent='Zapisz wydanie';const message=document.createElement('p');message.setAttribute('role','status');form.append(save,message);root.append(form);detail.append(root);
  const savedEdition=watchForm('catalog-edition',Object.values(fields));
  form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;try{const payload=Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,key==='publicationYear'?(input.value.trim()?Number(input.value):null):input.value]));await json('/api/catalog/editions/'+encodeURIComponent(row.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});savedEdition();await loadCatalogData();await openEditionDetail(row.id);}catch(error){message.textContent='Nie zapisano. Sprawdź tytuł, rok i pozostałe pola.';}finally{save.disabled=false;}});
  const comparison=document.createElement('details');const label=document.createElement('summary');label.textContent='Porównaj z innym wydaniem tego dzieła';comparison.append(label);
  const choice=document.createElement('select');choice.setAttribute('aria-label','Wydanie do porównania');const empty=document.createElement('option');empty.value='';empty.textContent='Wybierz wydanie';choice.append(empty);comparison.append(choice);const output=document.createElement('div');output.className='edition-comparison';comparison.append(output);detail.append(comparison);
  let loaded=false;comparison.addEventListener('toggle',async()=>{if(!comparison.open||loaded)return;try{const work=await json('/api/catalog/works/'+encodeURIComponent(row.workId));for(const edition of work.editions.filter(item=>item.id!==row.id)){const option=document.createElement('option');option.value=edition.id;option.textContent=[edition.title,edition.publisher,edition.publicationYear,edition.language].filter(Boolean).join(' · ');choice.append(option);}loaded=true;}catch(error){output.textContent='Nie udało się pobrać wydań.';}});
  choice.addEventListener('change',async()=>{if(!choice.value)return;try{const other=await json('/api/catalog/editions/'+encodeURIComponent(choice.value));output.replaceChildren();for(const [label,key] of [['Tytuł','title'],['Wydawca','publisher'],['Rok','publicationYear'],['Język','language'],['Oprawa','binding']]){const line=document.createElement('p');line.textContent=label+': '+(row[key]||'brak')+' ↔ '+(other[key]||'brak');output.append(line);}const ids=document.createElement('p');ids.textContent='ISBN: '+row.identifiers.filter(item=>item.scheme.startsWith('isbn')).map(item=>item.value).join(', ')+' ↔ '+other.identifiers.filter(item=>item.scheme.startsWith('isbn')).map(item=>item.value).join(', ');output.append(ids);}catch(error){output.textContent='Nie udało się porównać wydań.';}});
}
return { catalogRows, validCoverIsbn, coverPreviewMarkup, renderCatalog, openCatalogDetail, priceStats, offerPriceSummary, offerPriceSummaryMarkup, openEditionDetail };
}

