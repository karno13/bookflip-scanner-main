import {statusLabel,markDirty,allowDiscard,watchForm} from '../core/ux.js';
import { safeOfferHref } from '../core/formatters.js';
import { groszeToZloty, moneyFromZloty } from '../core/formatters.js';
import { isWatchedOffer, mountOfferWorkspace, loadOfferWorkspace, allSavedOfferNotes, readOfferNotes } from './offer-workspace.js';
// offers workspace, preserving existing behavior while isolating its implementation.
export function createOffersView({ state, $, $$, json, money, date, escapeHtml, allOffers, bookFor, showView, priceStats, onFiltersChange }) {
let drawerSerial=0;
let drawerTrigger=null;
let workspaceLoading = null;
function ensureWorkspaceLoaded() {
  if (!workspaceLoading) workspaceLoading = loadOfferWorkspace(json)
    .then(() => { renderOffers(); })
    .catch(error => { workspaceLoading = null; throw error; });
  return workspaceLoading;
}
function ensureWatchFilter() {
  const parent = document.querySelector('#legacyImportActions');
  if(!parent || parent.querySelector('#offerLegacyImport')) return;
  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.id='offerLegacyImport';
  importButton.hidden=Object.keys(readOfferNotes()).length===0;
  importButton.className = 'button secondary compact';
  importButton.textContent = 'Importuj lokalne notatki';
  importButton.addEventListener('click', async () => {
    if (!confirm('Przenieść lokalne notatki do SQLite? Istniejące wpisy w bazie zostaną pominięte.')) return;
    importButton.disabled = true;
    let imported = 0, skipped = 0, missing = 0, invalid = 0;
    try {
      const old = readOfferNotes();
      const entries = Object.entries(old).map(([offerId, entry]) => ({
        offerId,
        record: {
          watched: Boolean(entry?.watched),
          status: ['watching','check','negotiating','bought','rejected'].includes(entry?.status)
            ? entry.status : 'watching',
          targetPrice: Number.isFinite(entry?.targetPrice) && entry.targetPrice >= 0
            ? entry.targetPrice : null,
          note: String(entry?.note || '').slice(0, 2000),
        },
      }));
      for (let index = 0; index < entries.length; index += 10) {
        const outcome = await json('/api/offer-workspace/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: entries.slice(index, index + 10) }),
        });
        imported += outcome.imported;
        skipped += outcome.skipped;
        missing += outcome.missing;
        invalid += outcome.invalid;
      }
      await loadOfferWorkspace(json);
      renderOffers();
      alert(`Import: ${imported} zapisanych, ${skipped} bez zmian, ${missing} nieistniejących ofert, ${invalid} błędnych wpisów. Dane przeglądarki zachowano.`);
    } catch (error) {
      alert('Import nie został ukończony: ' + error.message + '. Dane przeglądarki zachowano.');
    }
    finally {importButton.disabled=false;}
  });
  parent.append(importButton);
}
function filteredOffers() {
  // Filters, ordering and pagination are applied once, across the full database.
  return [...allOffers()];
}

function renderOffers() {
  ensureWatchFilter();
  void ensureWorkspaceLoaded().catch(()=>{});
  if (!state.history) return;
  const rows = filteredOffers(),
    pages = Math.max(1, Math.ceil(state.catalogPages.offers.total / state.pageSize));
  state.offerPage = Math.min(state.offerPage, pages);
  const start = (state.offerPage - 1) * state.pageSize,
    pageRows = rows;
  $('#offerTotal').textContent =
    `${state.catalogPages.offers.total} pasujących ofert`;
  const mobile = $('#offersMobileList');
  if (mobile) {
    mobile.innerHTML =
      pageRows
        .map((item) => {
          const match =
            item.match ||
            (item.bookId
              ? { workTitle: bookFor(item.bookId)?.title, method: item.linkMode }
              : null);
          return `<button class="mobile-offer" data-mobile-offer-id="${escapeHtml(item.id)}" type="button"><span class="book-spine" aria-hidden="true">▤</span><span class="mobile-offer-copy"><strong>${escapeHtml(item.title || item.originalTitle)}</strong><small>${escapeHtml(item.source)} · ${escapeHtml(item.observedIsbn || item.isbn || 'ISBN nieznany')}</small></span><span class="mobile-offer-price"><b>${money(item.currentPrice)}</b><small>${item.targetReached ? 'Cena docelowa osiągnięta · ' : ''}${escapeHtml(item.purchaseStatus ? statusLabel(item.purchaseStatus) : match ? 'Dopasowane' : 'Do sprawdzenia')}</small></span></button>`;
        })
        .join('') || '<div class="empty-detail">Brak ofert zgodnych z filtrami.</div>';
    mobile
      .querySelectorAll('[data-mobile-offer-id]')
      .forEach((b) => b.addEventListener('click', () => openOfferDrawer(b.dataset.mobileOfferId)));
  }
  $('#offersTableBody').innerHTML = pageRows.length
    ? pageRows
        .map((offer) => {
          const matched =
            offer.match ||
            (offer.bookId
              ? { workTitle: bookFor(offer.bookId)?.title, method: offer.linkMode }
              : null);
          return `<tr><td><button class="link-button offer-title" type="button" data-offer-id="${escapeHtml(offer.id)}">${escapeHtml(offer.title || offer.originalTitle)}</button><span class="offer-subtitle">${escapeHtml(offer.matchedQueries?.join(', ') || '')}</span></td><td>${escapeHtml(offer.source)}</td><td>${money(offer.currentPrice)}${offer.targetReached ? ' ✓ próg' : ''}</td><td>${escapeHtml(offer.observedIsbn || offer.isbn || '-')}</td><td>${escapeHtml(matched?.workTitle || matched?.editionTitle || '-')}</td><td><strong>${escapeHtml(statusLabel(offer.purchaseStatus))}</strong><br><span class="status-pill ${matched?.method === 'manual' ? 'success' : matched ? 'warning' : 'neutral'}">${matched?.method === 'manual' ? 'Ręczne' : matched ? 'Automatyczne' : escapeHtml(statusLabel(offer.identification?.status))}</span></td><td>${escapeHtml(date(offer.lastSeenAt))}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="7" class="empty-cell">Brak ofert zgodnych z filtrami.</td></tr>';
  const activeSort = $('#offerSort').value;
  document.querySelectorAll('#view-offers [data-offer-sort]').forEach((button) => {
    const isActive = activeSort === button.dataset.offerSort || activeSort === button.dataset.offerSortReverse;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-label', button.textContent.trim() + (isActive ? ' — aktywne sortowanie' : ' — kliknij, aby sortować'));
    button.closest('th')?.setAttribute('aria-sort', !isActive ? 'none' :
      ['newest', 'title-desc', 'source-desc', 'price-desc'].includes(activeSort) ? 'descending' : 'ascending');
    const arrow = button.querySelector('.offer-sort-arrow');
    if (arrow) arrow.textContent = isActive
      ? (['newest', 'title-desc', 'source-desc', 'price-desc'].includes(activeSort) ? '↓' : '↑')
      : '↕';
  });
  $('#offerPageLabel').textContent = `Strona ${state.offerPage} z ${pages}`;
  $('#offerPrev').disabled = state.offerPage <= 1;
  $('#offerNext').disabled = state.offerPage >= pages;
  $$('[data-offer-id]').forEach((button) =>
    button.addEventListener('click', () => openOfferDrawer(button.dataset.offerId)),
  );
}

function priceEvidenceMarkup(offer) {
  const observations = Array.isArray(offer.priceHistory) ? offer.priceHistory : [];
  const stats = priceStats(observations.map((item) => item.price));
  const fields = [
    ['Obserwacje cen', String(stats?.count ?? 0)],
    ['Minimum historyczne', stats ? money(stats.min) : 'brak danych'],
    ['Mediana obserwacji', stats ? money(stats.median) : 'brak danych'],
  ];
  return `<section class="detail-section"><h4>Dowody cenowe</h4><div class="edition-price-summary">${fields.map(([name, value]) => `<div><small>${name}</small><strong>${value}</strong></div>`).join('')}</div><details class="detail-disclosure"><summary>Jak interpretować historię cen?</summary><p class="inline-note">Obserwacje dotyczą tego ogłoszenia, nie całego rynku. Wielokrotne odczyty tej samej ceny nie są niezależnymi transakcjami. Brak podstaw do wyliczenia wiarygodnego ROI.</p></details></section>`;
}

function scenarioCalculatorMarkup(offer) {
  const askingPrice = groszeToZloty(offer.currentPrice);
  return `<details class="detail-section scenario-calculator"><summary>Kalkulator scenariusza odsprzedaży</summary><details class="detail-disclosure"><summary>Założenia kalkulatora</summary><p class="inline-note">To tylko własne założenia. Cena ogłoszenia nie potwierdza możliwości zakupu, a wyliczenia nie są wyceną rynkową.</p></details><div class="scenario-fields"><label>Planowana cena zakupu (zł)<input id="scenarioPurchase" type="number" min="0" step="0.01" inputmode="decimal" value="${Number.isFinite(askingPrice) && askingPrice >= 0 ? askingPrice : ''}" placeholder="Podaj cenę"></label><label>Dostawa (zł)<input id="scenarioShipping" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Podaj koszt"></label><label>Inne koszty (zł)<input id="scenarioOther" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Prowizje, opłaty"></label><label>Zakładana cena odsprzedaży (zł)<input id="scenarioResale" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Twoje założenie"></label></div><output id="scenarioResult" class="scenario-result">Uzupełnij wszystkie pola, aby obliczyć hipotetyczny wynik przed podatkiem.</output><label class="field"><span>Faktyczna cena zakupu (zł, po zakupie)</span><input id="scenarioActualPurchase" type="number" min="0" step="0.01" inputmode="decimal"></label><button type="button" class="button secondary" id="saveScenario">Zapisz scenariusz i koszt zakupu</button><p id="scenarioSaveStatus" role="status"></p></details>`;
}
function calculateScenario() {
  const ids = ['scenarioPurchase', 'scenarioShipping', 'scenarioOther', 'scenarioResale'];
  const inputs = ids.map((id) => $('#' + id));
  const result = $('#scenarioResult');
  if (!result) return;
  if (inputs.some((input) => !input || input.value.trim() === '')) {
    result.textContent =
      'Uzupełnij wszystkie pola, aby obliczyć hipotetyczny wynik przed podatkiem.';
    return;
  }
  const values = inputs.map((input) => Number(input.value));
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    result.textContent = 'Wpisz poprawne kwoty nieujemne.';
    return;
  }
  const [purchase, shipping, other, resale] = values;
  const cost = purchase + shipping + other,
    profit = resale - cost;
  if (!Number.isFinite(cost) || !Number.isFinite(profit)) {
    result.textContent = 'Kwoty są poza dopuszczalnym zakresem.';
    return;
  }
  const roi = cost > 0 ? (profit / cost) * 100 : null;
  result.textContent = `Hipotetyczny pełny koszt: ${moneyFromZloty(cost)} · wynik: ${moneyFromZloty(profit)} · ROI: ${roi !== null && Number.isFinite(roi) ? roi.toFixed(1) + '%' : 'nieobliczalne przy koszcie 0'}. Przed podatkiem, bez gwarancji sprzedaży.`;
}

function closeOfferDrawer() {
  if(!allowDiscard()) return false;
  drawerSerial++;
  $('#offerDrawer').hidden=true;$('#drawerBackdrop').hidden=true;
  document.querySelector('.app-shell').inert=false;drawerTrigger?.focus();return true;
}
$('#drawerBackdrop')?.addEventListener('click',closeOfferDrawer);
$('#offerDrawer')?.addEventListener('keydown',event=>{
  if(event.key==='Escape') {event.preventDefault();closeOfferDrawer();}
  if(event.key==='Tab') {
    const controls=[...$('#offerDrawer').querySelectorAll('button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]')].filter(item=>item.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
});
async function openOfferDrawer(id) {
  if(!allowDiscard()) return;
  const serial=++drawerSerial;
  drawerTrigger=document.activeElement;
  $('#offerDrawer').hidden = false;
  $('#drawerBackdrop').hidden=false;document.querySelector('.app-shell').inert=true;
  $('#closeOfferDrawer').focus();
  $('#offerDrawerContent').innerHTML = '<p>Wczytywanie szczegółów...</p>';
  try {
    const offer = await json(`/api/offers/${encodeURIComponent(id)}`),
      active = offer.matches.find((item) => item.status === 'active');
    if(serial!==drawerSerial) return;
    $('#offerDrawerContent').innerHTML =
      `<span class="status-pill ${active ? 'success' : 'neutral'}">${active ? 'Przypisana' : escapeHtml(statusLabel(offer.identificationJob?.status))}</span><h2>${escapeHtml(offer.title)}</h2><div class="detail-grid"><span><b>Cena</b><small>${money(offer.currentPrice)}</small></span><span><b>Źródło</b><small>${escapeHtml(offer.source)}</small></span><span><b>ISBN</b><small>${escapeHtml(offer.observedIsbn || 'brak')}</small></span><span><b>Ostatnio wykryto</b><small>${escapeHtml(date(offer.lastSeenAt))}</small></span><span><b>Wykrycia</b><small>${offer.seenCount || 0}</small></span><span><b>Wydanie</b><small>${escapeHtml(active?.editionTitle || 'nieprzypisane')}</small></span></div>${priceEvidenceMarkup(offer)}${scenarioCalculatorMarkup(offer)}<section class="detail-section"><details class="detail-disclosure price-history-disclosure"><summary>Historia cen ofertowych (${Array.isArray(offer.priceHistory) ? offer.priceHistory.length : 0} obserwacji)</summary><p class="inline-note">Historia zapisanych cen ogłoszenia; nie potwierdza transakcji ani dostępności.</p><div class="price-list">${offer.priceHistory.map((item) => `<span><small>${escapeHtml(date(item.observedAt))}</small><b>${money(item.price)}</b></span>`).join('') || '<p>Brak obserwacji.</p>'}</div></details></section><div class="detail-actions"><a class="button primary" href="${escapeHtml(safeOfferHref(offer.url))}" target="_blank" rel="noreferrer">Otwórz ogłoszenie</a>${offer.identificationJob && offer.identificationJob.status === 'review_required' ? '<button class="button secondary" type="button" id="drawerReview">Przejdź do weryfikacji</button>' : ''}</div>`;
    const primaryActions = $('#offerDrawerContent .detail-actions');
    $('#offerDrawerContent h2').after(primaryActions);
    await ensureWorkspaceLoaded();
    if(serial!==drawerSerial) return;
    mountOfferWorkspace(offer, $('#offerDrawerContent'), ()=>{renderOffers();onFiltersChange?.();}, {json});
    const workspace=$('#offerDrawerContent .offer-workspace');
    $('#offerDrawerContent .detail-grid').after(workspace);
    const freshness=document.createElement('p');freshness.className='inline-note';
    const age=offer.lastSeenAt ? Math.floor((Date.now()-Date.parse(offer.lastSeenAt))/86400000) : null;
    freshness.textContent='Dostępność: '+(offer.availability==='unavailable'?'oznaczona jako niedostępna':'niepotwierdzona — sprawdź ogłoszenie')+(age!==null?' · od ostatniego wykrycia: '+age+' dni':'');
    $('#offerDrawerContent .detail-grid').after(freshness);
    const scenario=$('#offerDrawerContent .scenario-calculator');workspace.after(scenario);
    try {
      const [saved,defaults]=await Promise.all([json('/api/offer-scenarios/'+encodeURIComponent(id)),json('/api/trading-defaults')]);
      if(serial!==drawerSerial) return;
      const map={purchase:'scenarioPurchase',shipping:'scenarioShipping',other:'scenarioOther',resale:'scenarioResale',actualPurchase:'scenarioActualPurchase'};
      for(const [key,inputId] of Object.entries(map)) {
        const initial=saved.updatedAt ? saved[key] : key==='purchase'?groszeToZloty(offer.currentPrice):defaults[key];
        $('#'+inputId).value=initial??'';
      }
      const savedScenario=watchForm('scenario',Object.values(map).map(inputId=>$('#'+inputId)));
      calculateScenario();
      $('#saveScenario').addEventListener('click',async()=>{
        const button=$('#saveScenario');button.disabled=true;
        try {
          const body=Object.fromEntries(Object.entries(map).map(([key,inputId])=>[key,$('#'+inputId).value.trim()===''?null:Number($('#'+inputId).value)]));
          await json('/api/offer-scenarios/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
          if(serial!==drawerSerial)return;
          savedScenario();$('#scenarioSaveStatus').textContent='Zapisano scenariusz i faktyczny koszt.';
        }catch(error){$('#scenarioSaveStatus').textContent='Nie zapisano. Wpisz nieujemne kwoty do dwóch miejsc po przecinku.';}
        finally{button.disabled=false;}
      });
    } catch(error){if(serial!==drawerSerial)return;$('#scenarioSaveStatus').textContent='Nie udało się odczytać scenariusza. Otwórz ofertę ponownie.';$('#saveScenario').disabled=true;}
    if(active) {
      const catalogLink=document.createElement('button');catalogLink.type='button';catalogLink.className='button secondary';catalogLink.textContent='Wydanie i historia w katalogu';
      catalogLink.addEventListener('click',()=>{if(!closeOfferDrawer())return;document.dispatchEvent(new CustomEvent('bookflip-open-edition',{detail:{editionId:active.editionId}}));});
      $('#offerDrawerContent .detail-actions').append(catalogLink);
      const comparison=document.createElement('button');comparison.type='button';comparison.className='button secondary';comparison.textContent='Porównaj ceny tego wydania';
      comparison.addEventListener('click',async()=>{
        if(!allowDiscard())return;
        let edition;
        try { edition=await json('/api/catalog/editions/'+encodeURIComponent(active.editionId)); }
        catch { toast('Nie udało się pobrać porównania cen. Spróbuj ponownie.'); return; }
        const panel=document.createElement('section');panel.className='detail-section';
        const title=document.createElement('h4');title.textContent='Porównanie zapisanych ofert tego wydania';panel.append(title);
        for(const item of edition.offers) {
          const row=document.createElement('p');row.textContent=item.source+' · '+money(item.currentPrice)+' · wykryto '+date(item.lastSeenAt)+' · '+(item.availability==='unavailable'?'niedostępna':'dostępność niepotwierdzona');panel.append(row);
        }
        comparison.replaceWith(panel);
      });scenario.after(comparison);
    }
    ['scenarioPurchase', 'scenarioShipping', 'scenarioOther', 'scenarioResale'].forEach((id) =>
      $('#' + id)?.addEventListener('input', calculateScenario),
    );
    $('#drawerReview')?.addEventListener('click', () => {
      if(!closeOfferDrawer())return;
      document.dispatchEvent(new CustomEvent('bookflip-review-offer',{detail:{offerId:offer.id,jobId:offer.identificationJob.id}}));
    });
  } catch (error) {
    if(serial!==drawerSerial)return;
    $('#offerDrawerContent').innerHTML = '<p>Nie udało się wczytać szczegółów. Zamknij panel i spróbuj ponownie. Nie zmieniono zapisanych danych.</p>';
  }
}




return { filteredOffers, renderOffers, priceEvidenceMarkup, scenarioCalculatorMarkup, calculateScenario, openOfferDrawer, closeOfferDrawer };
}

