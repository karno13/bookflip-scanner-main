import { mountSeriesEditor, readSeries, seriesSummary } from './series.js';
// catalog workspace, preserving existing behavior while isolating its implementation.
export function createCatalogView({ state, $, $$, json, money, escapeHtml, visibleCatalogRows }) {
function catalogRows() {
  const query = $('#catalogSearch').value.trim().toLocaleLowerCase('pl'),
    sort = $('#catalogSort').value;
  const rows = state.catalogWorks.filter(
    (row) =>
      !query ||
      `${row.title} ${row.authors.join(' ')} ${row.editions.flatMap((edition) => edition.identifiers.map((item) => item.value)).join(' ')}`
        .toLocaleLowerCase('pl')
        .includes(query),
  );
  return rows.sort((a, b) =>
    sort === 'offers' ? b.offerCount - a.offerCount : a.title.localeCompare(b.title, 'pl'),
  );
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
  return saved;
}
function renderCatalog() {
  if (!state.history) return;
  renderSeriesSummary();
  if (sqliteAnnotations === null && !seriesRequest) void loadSeries().catch(() => {});
  const rows = catalogRows();
  $('#catalogList').innerHTML = rows.length
    ? visibleCatalogRows('works', rows)
        .map(
          (row) =>
            `<button class="catalog-row ${row.id === state.selectedCatalogId ? 'active' : ''}" type="button" data-catalog-id="${escapeHtml(row.id)}"><span class="catalog-book-title">${coverPreviewMarkup(row.editions.flatMap((edition) => edition.identifiers))}<span class="catalog-book-copy"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.authors.join(', ') || 'Autor nieznany')}</small><small class="catalog-isbn">${escapeHtml(row.editions.flatMap((e) => e.identifiers.filter((v) => v.scheme.startsWith('isbn')).map((v) => v.value))[0] || 'ISBN nieznany')}</small></span></span><span>${row.editionCount}</span><span>${row.offerCount}</span><span><span class="status-pill ${['manual', 'verified'].includes(row.verificationStatus) ? 'success' : 'warning'}">${escapeHtml(row.verificationStatus)}</span></span></button>`,
        )
        .join('')
    : '<div class="empty-detail"><h3>Katalog jest pusty</h3><p>Zaimportuj dane historyczne albo dodaj rekord.</p></div>';
  $$('[data-catalog-id]').forEach((button) =>
    button.addEventListener('click', () => openCatalogDetail(button.dataset.catalogId)),
  );
}

function renderSeriesSummary() {
  const anchor = $('#catalogList');
  if (!anchor) return;
  let panel = $('#catalogSeriesSummary');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'catalogSeriesSummary';
    panel.className = 'series-summary panel';
    anchor.parentElement.before(panel);
  }
  const groups = seriesSummary(state.catalogWorks, sqliteAnnotations || {});
  panel.replaceChildren();
  const label = document.createElement('strong');
  label.textContent = 'Serie zapisane w SQLite';
  panel.append(label);
  const info = document.createElement('p');
  info.textContent = sqliteAnnotations === null ? 'Ładowanie serii z SQLite…' : groups.length ? groups.map(group => `${group.name}: tomy ${group.volumes.join(', ')}${group.missing.length ? ` · brak numerów ${group.missing.join(', ')}` : ''}`).join(' | ') : 'Wybierz dzieło, aby przypisać serię i numer tomu.';
  panel.append(info);
  const legacy = readSeries();
  const pending = Object.entries(legacy).filter(([workId, entry]) =>
    entry && typeof entry.series === 'string' && entry.series.trim() &&
    Number.isSafeInteger(entry.volume) && entry.volume > 0 && entry.volume <= 10000 &&
    sqliteAnnotations && !Object.hasOwn(sqliteAnnotations, workId));
  if (sqliteAnnotations !== null && pending.length) {
    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.className = 'button secondary compact';
    importButton.textContent = 'Importuj lokalne oznaczenia (' + pending.length + ')';
    const result = document.createElement('small');
    result.setAttribute('role', 'status');
    importButton.addEventListener('click', async () => {
      if (!confirm('Importować ' + pending.length + ' lokalnych oznaczeń do SQLite? Istniejące wpisy zostaną pominięte.')) return;
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
  state.selectedCatalogId = id;
  renderCatalog();
  const detail = $('#catalogDetail');
  detail.innerHTML = '<div class="empty-detail"><p>Wczytywanie rekordu...</p></div>';
  try {
    const row = await json(`/api/catalog/works/${encodeURIComponent(id)}`);
    detail.innerHTML = `<section class="detail-section"><div class="book-detail-title"><div><span class="status-pill ${['manual', 'verified'].includes(row.verificationStatus) ? 'success' : 'warning'}">${escapeHtml(row.verificationStatus)}</span><h3>${escapeHtml(row.title)}</h3><p>${escapeHtml(row.authors.join(', ') || 'Autor nieznany')}</p></div><strong>${row.editions.length} wydań</strong></div></section><section class="detail-section"><h4>Wydania — wybierz, aby zobaczyć oferty i ceny</h4><div class="price-list">${row.editions.map((edition) => `<button type="button" class="link-button" data-edition-detail="${escapeHtml(edition.id)}"><span><strong>${escapeHtml(edition.title)}</strong><small>${escapeHtml([edition.publisher, edition.publicationYear, edition.language].filter(Boolean).join(' / ') || 'Brak szczegółów')}</small></span><b>${escapeHtml(edition.identifiers.find((item) => item.scheme.startsWith('isbn'))?.value || 'bez ISBN')}</b></button>`).join('') || '<p>Brak wydań.</p>'}</div></section><section class="detail-section"><h4>Pochodzenie</h4><p class="inline-note">${row.externalRecords.length ? row.externalRecords.map((record) => `${escapeHtml(record.provider)}: ${escapeHtml(record.externalId)}`).join(', ') : 'Brak zewnętrznych rekordów bibliograficznych.'}</p></section>`;
    try { await loadSeries(); } catch (error) { /* Edytor pokaże błąd zapisu, jeśli baza jest niedostępna. */ }
    mountSeriesEditor(row, detail, renderSeriesSummary, { annotations: sqliteAnnotations || {}, save: saveSeries });
    $$('[data-edition-detail]').forEach((button) =>
      button.addEventListener('click', () => openEditionDetail(button.dataset.editionDetail)),
    );
  } catch (error) {
    detail.innerHTML = `<div class="empty-detail"><h3>Nie udalo sie wczytac rekordu</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function priceStats(prices) {
  const sorted = prices
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
  return priceStats(offers.map((item) => item.currentPrice));
}
function offerPriceSummaryMarkup(offers = []) {
  const stats = offerPriceSummary(offers);
  if (!stats) return '<p class="inline-note">Brak zapisanych cen ofertowych dla tego wydania.</p>';
  return `<div class="edition-price-summary"><div><small>Mediana cen ofertowych</small><strong>${money(stats.median)}</strong></div><div><small>Najniższa oferta</small><strong>${money(stats.min)}</strong></div><div><small>Liczba cen</small><strong>${stats.count}</strong></div></div><p class="inline-note">Wartości na podstawie aktualnych cen zapisanych ofert. Nie są to ceny sprzedaży ani prognoza zysku; nie uwzględniają kosztów dostawy i stanu egzemplarza.</p>`;
}

async function openEditionDetail(id) {
  const detail = $('#catalogDetail');
  detail.innerHTML = '<div class="empty-detail"><p>Wczytywanie wydania...</p></div>';
  try {
    const row = await json(`/api/catalog/editions/${encodeURIComponent(id)}`);
    detail.innerHTML = `<section class="detail-section"><button class="link-button" id="backToWork" type="button">← Wróć do dzieła</button><div class="edition-identity">${coverPreviewMarkup(row.identifiers)}<div><h3>${escapeHtml(row.title)}</h3><p class="inline-note">${escapeHtml(row.authors?.join(', ') || 'Autor nieznany')}</p></div></div><div class="detail-grid"><span><b>ISBN</b><small>${escapeHtml(
      row.identifiers
        .filter((item) => item.scheme.startsWith('isbn'))
        .map((item) => item.value)
        .join(', ') || 'brak',
    )}</small></span><span><b>Wydawca</b><small>${escapeHtml(row.publisher || '-')}</small></span><span><b>Rok</b><small>${escapeHtml(row.publicationYear || '-')}</small></span><span><b>Język / oprawa</b><small>${escapeHtml([row.language, row.binding].filter(Boolean).join(' / ') || '-')}</small></span></div></section><section class="detail-section"><h4>Analiza cen wydania</h4>${offerPriceSummaryMarkup(row.offers)}</section><section class="detail-section"><h4>Powiązane oferty</h4><div class="price-list">${row.offers.map((item) => `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer"><span>${escapeHtml(item.title)}<small>${escapeHtml(item.source)}</small></span><b>${money(item.currentPrice)}</b></a>`).join('') || '<p>Brak ofert.</p>'}</div></section>`;
    $('#backToWork').addEventListener('click', () => openCatalogDetail(row.workId));
  } catch (error) {
    detail.innerHTML = `<div class="empty-detail"><p>${escapeHtml(error.message)}</p></div>`;
  }
}


return { catalogRows, validCoverIsbn, coverPreviewMarkup, renderCatalog, openCatalogDetail, priceStats, offerPriceSummary, offerPriceSummaryMarkup, openEditionDetail };
}

