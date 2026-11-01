// offers workspace, preserving existing behavior while isolating its implementation.
export function createOffersView({ state, $, $, json, money, date, escapeHtml, allOffers, bookFor, showView, priceStats }) {
function filteredOffers() {
  const query = $('#offerSearch').value.trim().toLocaleLowerCase('pl'),
    source = $('#offerSource').value,
    status = $('#offerStatus').value,
    sort = $('#offerSort').value;
  const rows = allOffers().filter(
    (offer) =>
      (!query ||
        `${offer.title || offer.originalTitle} ${offer.source} ${offer.observedIsbn || offer.isbn || ''}`
          .toLocaleLowerCase('pl')
          .includes(query)) &&
      (!source || offer.source === source) &&
      (!status || (status === 'matched') === Boolean(offer.match || offer.bookId)),
  );
  return rows.sort((a, b) =>
    sort === 'price-asc'
      ? a.currentPrice - b.currentPrice
      : sort === 'price-desc'
        ? b.currentPrice - a.currentPrice
        : sort === 'title'
          ? (a.title || a.originalTitle).localeCompare(b.title || b.originalTitle, 'pl')
          : String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)),
  );
}

function renderOffers() {
  if (!state.history) return;
  const rows = filteredOffers(),
    pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.offerPage = Math.min(state.offerPage, pages);
  const start = (state.offerPage - 1) * state.pageSize,
    pageRows = rows.slice(start, start + state.pageSize);
  $('#offerTotal').textContent =
    `${rows.length} pasujących z ${state.catalogPages.offers.offset} wczytanych (${state.catalogPages.offers.total} łącznie)`;
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
          return `<button class="mobile-offer" data-mobile-offer-id="${escapeHtml(item.id)}" type="button"><span class="book-spine" aria-hidden="true">▤</span><span class="mobile-offer-copy"><strong>${escapeHtml(item.title || item.originalTitle)}</strong><small>${escapeHtml(item.source)} · ${escapeHtml(item.observedIsbn || item.isbn || 'ISBN nieznany')}</small><small class="mobile-offer-match">${escapeHtml(match?.workTitle || match?.editionTitle || 'Nieprzypisana do wydania')}</small></span><span class="mobile-offer-price"><b>${money(item.currentPrice)}</b><small>${escapeHtml(match?.method === 'manual' ? 'Ręczne' : match ? 'Dopasowane' : 'Do sprawdzenia')}</small></span></button>`;
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
          return `<tr><td><button class="link-button offer-title" type="button" data-offer-id="${escapeHtml(offer.id)}">${escapeHtml(offer.title || offer.originalTitle)}</button><span class="offer-subtitle">${escapeHtml(offer.matchedQueries?.join(', ') || '')}</span></td><td>${escapeHtml(offer.source)}</td><td>${money(offer.currentPrice)}</td><td>${escapeHtml(offer.observedIsbn || offer.isbn || '-')}</td><td>${escapeHtml(matched?.workTitle || matched?.editionTitle || '-')}</td><td><span class="status-pill ${matched?.method === 'manual' ? 'success' : matched ? 'warning' : 'neutral'}">${matched?.method === 'manual' ? 'Ręczne' : matched ? 'Automatyczne' : escapeHtml(offer.identification?.status || 'Nieprzypisana')}</span></td><td>${escapeHtml(date(offer.lastSeenAt))}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="7" class="empty-cell">Brak ofert zgodnych z filtrami.</td></tr>';
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
  const askingPrice = Number(offer.currentPrice);
  return `<section class="detail-section scenario-calculator"><h4>Kalkulator scenariusza odsprzedaży</h4><details class="detail-disclosure"><summary>Założenia kalkulatora</summary><p class="inline-note">To tylko własne założenia. Cena ogłoszenia nie potwierdza możliwości zakupu, a wyliczenia nie są wyceną rynkową.</p></details><div class="scenario-fields"><label>Cena zakupu (zł)<input id="scenarioPurchase" type="number" min="0" step="0.01" inputmode="decimal" value="${Number.isFinite(askingPrice) && askingPrice >= 0 ? askingPrice : ''}" placeholder="Podaj cenę"></label><label>Dostawa (zł)<input id="scenarioShipping" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Podaj koszt"></label><label>Inne koszty (zł)<input id="scenarioOther" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Prowizje, opłaty"></label><label>Zakładana cena odsprzedaży (zł)<input id="scenarioResale" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Twoje założenie"></label></div><output id="scenarioResult" class="scenario-result">Uzupełnij wszystkie pola, aby obliczyć hipotetyczny wynik przed podatkiem.</output></section>`;
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
  result.textContent = `Hipotetyczny pełny koszt: ${money(cost)} · wynik: ${money(profit)} · ROI: ${roi !== null && Number.isFinite(roi) ? roi.toFixed(1) + '%' : 'nieobliczalne przy koszcie 0'}. Przed podatkiem, bez gwarancji sprzedaży.`;
}

async function openOfferDrawer(id) {
  $('#offerDrawer').hidden = false;
  $('#offerDrawerContent').innerHTML = '<p>Wczytywanie szczegółów...</p>';
  try {
    const offer = await json(`/api/offers/${encodeURIComponent(id)}`),
      active = offer.matches.find((item) => item.status === 'active');
    $('#offerDrawerContent').innerHTML =
      `<span class="status-pill ${active ? 'success' : 'neutral'}">${active ? 'Przypisana' : escapeHtml(offer.identificationJob?.status || 'Bez przypisania')}</span><h2>${escapeHtml(offer.title)}</h2><div class="detail-grid"><span><b>Cena</b><small>${money(offer.currentPrice)}</small></span><span><b>Zrodlo</b><small>${escapeHtml(offer.source)}</small></span><span><b>ISBN</b><small>${escapeHtml(offer.observedIsbn || 'brak')}</small></span><span><b>Ostatnio</b><small>${escapeHtml(date(offer.lastSeenAt))}</small></span><span><b>Wykrycia</b><small>${offer.seenCount || 0}</small></span><span><b>Wydanie</b><small>${escapeHtml(active?.editionTitle || 'nieprzypisane')}</small></span></div>${priceEvidenceMarkup(offer)}${scenarioCalculatorMarkup(offer)}<section class="detail-section"><details class="detail-disclosure price-history-disclosure"><summary>Historia cen ofertowych (${Array.isArray(offer.priceHistory) ? offer.priceHistory.length : 0} obserwacji)</summary><details class="detail-disclosure"><summary>O tych danych</summary><p class="inline-note">Historia zapisanych cen ogłoszenia; nie potwierdza transakcji ani dostępności.</p></details><div class="price-list">${offer.priceHistory.map((item) => `<span><small>${escapeHtml(date(item.observedAt))}</small><b>${money(item.price)}</b></span>`).join('') || '<p>Brak obserwacji.</p>'}</div></details></section><div class="detail-actions"><a class="button primary" href="${escapeHtml(offer.url)}" target="_blank" rel="noreferrer">Otworz ogloszenie</a>${offer.identificationJob && offer.identificationJob.status !== 'completed' ? '<button class="button secondary" type="button" id="drawerReview">Przejdz do weryfikacji</button>' : ''}</div>`;
    ['scenarioPurchase', 'scenarioShipping', 'scenarioOther', 'scenarioResale'].forEach((id) =>
      $('#' + id)?.addEventListener('input', calculateScenario),
    );
    $('#drawerReview')?.addEventListener('click', () => {
      state.selectedReviewId = offer.identificationJob.id;
      state.reviewDetail = offer;
      $('#offerDrawer').hidden = true;
      showView('review');
    });
  } catch (error) {
    $('#offerDrawerContent').innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}




return { filteredOffers, renderOffers, priceEvidenceMarkup, scenarioCalculatorMarkup, calculateScenario, openOfferDrawer };
}
