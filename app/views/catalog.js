import { mountEditionHistory } from './edition-history.js';
import { openDetailView } from '../core/detail-navigation.js';
import {markDirty,statusLabel,allowDiscard,watchForm} from '../core/ux.js';
import { safeOfferHref } from '../core/formatters.js';
import { mountSeriesEditor, readSeries, seriesSummary } from './series.js';
// catalog workspace, preserving existing behavior while isolating its implementation.
export function createCatalogView({ state, $, $$, json, money, escapeHtml, visibleCatalogRows, openOfferDrawer, loadCatalogData }) {
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
  return saved;
}
function renderEditionRail(work, selectedId = null) {
  const panel = $('#catalogEditionsPanel');
  if (!panel) return;
  panel.dataset.workId = work.id;
  panel.innerHTML = '<div class="edition-rail-heading">Wydania ? ' + work.editions.length + '</div><div class="edition-rail-book">' + escapeHtml(work.title) + '</div>' + work.editions.map(edition => '<button type="button" class="edition-rail-row' + (edition.id === selectedId ? ' active' : '') + '" data-rail-edition="' + escapeHtml(edition.id) + '" aria-pressed="' + (edition.id === selectedId) + '"><strong>' + escapeHtml(edition.title) + '</strong><small>' + escapeHtml([edition.publisher, edition.publicationYear, edition.language, edition.binding].filter(Boolean).join(' ? ') || 'Brak danych bibliograficznych') + '</small><span class="rail-isbn">' + escapeHtml(edition.identifiers.find(item => item.scheme.startsWith('isbn'))?.value || 'Brak ISBN') + '</span></button>').join('');
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
  const rows = catalogRows();
  $('#catalogList').innerHTML = rows.length
    ? visibleCatalogRows('works', rows)
        .map(
          (row) =>
            `<button class="catalog-row ${row.id === state.selectedCatalogId ? 'active' : ''}" type="button" data-catalog-id="${escapeHtml(row.id)}"><span class="catalog-book-title">${coverPreviewMarkup(row.editions.flatMap((edition) => edition.identifiers))}<span class="catalog-book-copy"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.authors.join(', ') || 'Autor nieznany')}</small><small class="catalog-isbn">${escapeHtml(row.editions.flatMap((e) => e.identifiers.filter((v) => v.scheme.startsWith('isbn')).map((v) => v.value))[0] || 'ISBN nieznany')}</small><small>${escapeHtml(row.editionCount === 1 ? [row.editions[0]?.publisher, row.editions[0]?.publicationYear, row.editions[0]?.language].filter(Boolean).join(' · ') || 'Brak danych wydania' : `${row.editionCount} wydań — otwórz szczegóły`)}</small></span></span><span>${row.editionCount}</span><span>${row.offerCount}</span><span><span class="status-pill ${['manual', 'verified'].includes(row.verificationStatus) ? 'success' : 'warning'}">${escapeHtml(statusLabel(row.verificationStatus))}</span></span></button>`,
        )
        .join('')
    : queryEmptyMarkup();
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
  if(!allowDiscard()) return;
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
    detail.innerHTML = `<section class="detail-section"><div class="book-detail-title"><div><span class="status-pill ${['manual', 'verified'].includes(row.verificationStatus) ? 'success' : 'warning'}">${escapeHtml(statusLabel(row.verificationStatus))}</span><h3>${escapeHtml(row.title)}</h3><p>${escapeHtml(row.authors.join(', ') || 'Autor nieznany')}</p></div><strong>${row.editions.length} wydań</strong></div></section><section class="detail-section"><h4>Wydania — wybierz, aby zobaczyć oferty i ceny</h4><div class="price-list">${row.editions.map((edition) => `<button type="button" class="link-button" data-edition-detail="${escapeHtml(edition.id)}"><span><strong>${escapeHtml(edition.title)}</strong><small>${escapeHtml([edition.publisher, edition.publicationYear, edition.language].filter(Boolean).join(' / ') || 'Brak szczegółów')}</small></span><b>${escapeHtml(edition.identifiers.find((item) => item.scheme.startsWith('isbn'))?.value || 'bez ISBN')}</b></button>`).join('') || '<p>Brak wydań.</p>'}</div></section><details class="detail-section"><summary>Pochodzenie danych bibliograficznych</summary><p class="inline-note">${row.externalRecords.length ? row.externalRecords.map((record) => `${escapeHtml(record.provider)}: ${escapeHtml(record.externalId)}`).join(', ') : 'Brak zewnętrznych rekordów bibliograficznych.'}</p></section>`;
    try { await loadSeries(); } catch (error) { /* Edytor pokaże błąd zapisu, jeśli baza jest niedostępna. */ }
    if (request !== detailRequest) return;
    mountWorkActions(row,detail);
    mountSeriesEditor(row, detail, renderSeriesSummary, { annotations: sqliteAnnotations || {}, save: saveSeries });
    detail.querySelectorAll('[data-edition-detail]').forEach((button) =>
      button.addEventListener('click', () => openEditionDetail(button.dataset.editionDetail)),
    );
  } catch (error) {
    if (request !== detailRequest) return;
    detail.innerHTML = `<div class="empty-detail"><h3>Nie udalo sie wczytac rekordu</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
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
  if(!allowDiscard())return;
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
      }).catch(() => { if (request === detailRequest) rail.textContent = 'Nie uda?o si? odczyta? listy wyda?.'; });
    }
    detail.innerHTML = `<section class="detail-section"><button class="link-button" id="backToWork" type="button">← Wróć do dzieła</button><div class="edition-identity">${coverPreviewMarkup(row.identifiers)}<div><h3>${escapeHtml(row.title)}</h3><p class="inline-note">${escapeHtml(row.authors?.join(', ') || 'Autor nieznany')}</p></div></div><div class="detail-grid"><span><b>ISBN</b><small>${escapeHtml(
      row.identifiers
        .filter((item) => item.scheme.startsWith('isbn'))
        .map((item) => item.value)
        .join(', ') || 'brak',
    )}</small></span><span><b>Wydawca</b><small>${escapeHtml(row.publisher || '-')}</small></span><span><b>Rok</b><small>${escapeHtml(row.publicationYear || '-')}</small></span><span><b>Język / oprawa</b><small>${escapeHtml([row.language, row.binding].filter(Boolean).join(' / ') || '-')}</small></span></div></section><section class="detail-section"><h4>Ceny zapisanych ofert</h4>${offerPriceSummaryMarkup(row.offers)}</section><section class="detail-section"><h4>Powiązane oferty</h4><div class="price-list">${row.offers.map((item) => `<button class="link-button" type="button" data-edition-offer="${escapeHtml(item.id)}"><span>${escapeHtml(item.title)}<small>${escapeHtml(item.source)} · wykryto ${escapeHtml(item.lastSeenAt || 'brak daty')} · ${escapeHtml(item.availability==='unavailable'?'niedostępna':'dostępność niepotwierdzona')}</small></span><b>${money(item.currentPrice)}</b></button>`).join('') || '<p>Brak ofert.</p>'}</div></section>`;
    detail.querySelectorAll('[data-edition-offer]').forEach(button=>button.addEventListener('click',()=>openOfferDrawer(button.dataset.editionOffer)));
    const history = mountEditionHistory({ row, target: detail, json, money, openOfferDrawer });
    detail.querySelectorAll('.detail-section')[2].before(history);
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
      button.addEventListener('click',async()=>{button.disabled=true;try{const payload={sourceId:row.id,targetId:target.id};const preview=await json('/api/catalog/merge-works',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!confirm('Przenieść '+preview.editions+' wydań z „'+preview.sourceTitle+'” do „'+preview.targetTitle+'”? Dane docelowego dzieła pozostaną. Historyczne decyzje zostaną zachowane.')) return;
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

