import { safeOfferHref } from '../core/formatters.js';
import { metadataComparisonMarkup } from '../core/metadata-comparison.js';
// review workspace, preserving existing behavior while isolating its implementation.
export function createReviewView({ state, $, $$, json, toast, money, date, escapeHtml, reviewOffers, loadCatalogData, renderCatalog }) {
function filteredReviewOffers() {
  const query = $('#reviewSearch').value.trim().toLocaleLowerCase('pl'),
    source = $('#reviewSource').value,
    isbn = $('#reviewIsbn').value;
  const rows = reviewOffers().filter((job) => {
    const offer = job.offer;
    return (
      (!query ||
        `${offer.title} ${offer.source} ${offer.observedIsbn || ''}`
          .toLocaleLowerCase('pl')
          .includes(query)) &&
      (!source || offer.source === source) &&
      (!isbn || (isbn === 'present') === Boolean(offer.observedIsbn))
    );
  });
  return rows.sort((a, b) =>
    $('#reviewSort').value === 'price'
      ? a.offer.currentPrice - b.offer.currentPrice
      : String(b.offer.lastSeenAt).localeCompare(String(a.offer.lastSeenAt)),
  );
}

// Keep at most a bounded number of catalog/review DOM nodes alive even
// after many SQLite pages have been fetched.
function visibleCatalogRows(kind, rows) {
  const visible = state.visibleRows[kind] || 100;
  const slice = rows.slice(0, visible);
  const view = document.querySelector('#view-' + (kind === 'works' ? 'catalog' : 'review'));
  if (view && kind !== 'jobs') {
    let button = view.querySelector('[data-show-loaded-kind="' + kind + '"]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'button-secondary catalog-load-more';
      button.dataset.showLoadedKind = kind;
      button.addEventListener('click', () => {
        state.visibleRows[kind] += 100;
        if (kind === 'works') renderCatalog();
        else renderReview();
      });
      view.append(button);
    }
    button.hidden = rows.length <= visible;
    button.textContent = `Pokaż kolejne wczytane (${Math.min(visible, rows.length)} z ${rows.length})`;
  }
  return slice;
}

function renderReview() {
  if (!state.history) return;
  const rows = filteredReviewOffers();
  $('#reviewCount').textContent = `${rows.length} z ${state.catalogPages.jobs.total} oczekujących`;
  $('#reviewNavCount').textContent = `${reviewOffers().length} pozycji`;
  if (state.selectedReviewId && !rows.some((row) => row.id === state.selectedReviewId))
    state.selectedReviewId = null;
  const reviewListScroll = $('#reviewList').scrollTop;
  $('#reviewList').innerHTML = rows.length
    ? visibleCatalogRows('jobs', rows)
        .map((job) => {
          const offer = job.offer;
          return `<button class="review-item ${job.id === state.selectedReviewId ? 'active' : ''}" type="button" aria-current="${job.id === state.selectedReviewId ? 'true' : 'false'}" data-review-id="${escapeHtml(job.id)}"><span class="book-spine" aria-hidden="true">▤</span><span><strong>${escapeHtml(offer.title)}</strong><small>${escapeHtml(offer.source)} - ${offer.observedIsbn ? `ISBN ${escapeHtml(offer.observedIsbn)}` : 'brak ISBN'}</small><small>${escapeHtml(job.status)}${job.lastError ? ` - ${escapeHtml(job.lastError)}` : ''}</small></span><span class="review-price">${money(offer.currentPrice)}</span></button>`;
        })
        .join('')
    : '<div class="empty-detail"><h3>Brak pozycji</h3><p>Filtry nie zwracaja ofert wymagajacych decyzji.</p></div>';
  $('#reviewList').scrollTop = reviewListScroll;
  $$('[data-review-id]').forEach((button) =>
    button.addEventListener('click', async () => {
      state.selectedReviewId = button.dataset.reviewId;
      state.reviewDetail = null;
      $('#reviewDetail').dataset.jobId = '';
      renderReview();
      $('#reviewList').querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
      const job = state.reviewJobs.find((row) => row.id === state.selectedReviewId);
      if (job) {
        try {
          const detail = await json(`/api/offers/${encodeURIComponent(job.offerId)}`);
          if (state.selectedReviewId !== job.id) return;
          state.reviewDetail = detail;
          renderReviewDetail();
        } catch (error) {
          if (state.selectedReviewId === job.id) toast(error.message);
        }
      }
    }),
  );
  if ($('#reviewDetail').dataset.jobId !== (state.selectedReviewId || '')) renderReviewDetail();
}

function normalizedIsbn(value) {
  return String(value || '')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
}
function reviewCandidateMarkup(offer, suggested) {
  if (!suggested)
    return '<p class="inline-note">Brak propozycji w załadowanym katalogu. Wyszukaj ręcznie wydanie poniżej.</p>';
  const { work, edition } = suggested;
  const observed = normalizedIsbn(offer.observedIsbn);
  const identifiers = (edition.identifiers || [])
    .filter((item) => String(item.scheme).startsWith('isbn'))
    .map((item) => normalizedIsbn(item.value));
  const conflict = Boolean(observed && identifiers.length && !identifiers.includes(observed));
  const fact = !observed
    ? 'Brak ISBN w ogłoszeniu'
    : !identifiers.length
      ? 'Brak ISBN w katalogowym wydaniu'
      : conflict
        ? 'RÓŻNE ISBN — sprawdź wydanie'
        : 'Zgodny ISBN';
  return `<div class="comparison-candidate"><span class="book-spine" aria-hidden="true">▤</span><span class="candidate-body"><b>${escapeHtml(work.title)}</b><small>${escapeHtml(work.authors.join(', ') || 'Autor nieznany')}</small><small>Wydanie: ${escapeHtml(edition.title)}</small><small>Wydawca: ${escapeHtml(edition.publisher || 'nieznany')} · Rok: ${escapeHtml(edition.publicationYear || 'nieznany')}</small><small>ISBN wydania: ${escapeHtml(identifiers.join(', ') || 'brak')}</small></span></div><div class="verification-fact ${conflict ? 'verification-conflict' : observed && identifiers.includes(observed) ? 'verification-match' : 'verification-unknown'}"><strong>Porównanie ISBN:</strong> ${escapeHtml(fact)}</div>`;
}

function renderReviewDetail() {
  const job = reviewOffers().find((row) => row.id === state.selectedReviewId);
  if (!job) {
    $('#reviewDetail').dataset.jobId = '';
    return ($('#reviewDetail').innerHTML =
      '<div class="empty-detail"><h3>Wybierz ofertę</h3><p>Po lewej pojawia się lista ofert wymagajacych decyzji.</p></div>');
  }
  $('#reviewDetail').dataset.jobId = job.id;
  const offer = state.reviewDetail || job.offer,
    evidence = state.reviewDetail?.evidence || [],
    result = job.result || {};
  const suggested = result.editionId
    ? state.catalogWorks
        .flatMap((w) => w.editions.map((e) => ({ work: w, edition: e })))
        .find((x) => x.edition.id === result.editionId)
    : null;
  const candidate = reviewCandidateMarkup(offer, suggested);
  const observedCandidateIsbn = normalizedIsbn(offer.observedIsbn);
  const suggestedIsbns = (suggested?.edition.identifiers || [])
    .filter((identifier) => String(identifier.scheme).startsWith('isbn'))
    .map((identifier) => normalizedIsbn(identifier.value));
  const suggestedIsbnConflict = Boolean(
    observedCandidateIsbn && suggestedIsbns.length && !suggestedIsbns.includes(observedCandidateIsbn),
  );

  $('#reviewDetail').innerHTML =
    `<div class="lean-review">
      <header class="lean-review-header">
        <div class="lean-review-heading"><span class="status-pill warning">${escapeHtml(job.status)}</span><h3>${escapeHtml(offer.title)}</h3><span class="lean-review-meta">${escapeHtml(offer.source)} · ${escapeHtml(date(offer.lastSeenAt))}</span></div>
        <div class="lean-review-offer"><strong>${money(offer.currentPrice)}</strong><a href="${escapeHtml(safeOfferHref(offer.url))}" target="_blank" rel="noreferrer">Ogłoszenie ↗</a></div>
      </header>
      <div class="lean-review-body">
        <div class="lean-review-isbn">
          <label for="reviewIsbnCheckInput"><strong>ISBN</strong><span>${escapeHtml(offer.observedIsbn || 'nie wykryto — wpisz ręcznie')}</span></label>
          <div class="lean-review-isbn-tools"><input id="reviewIsbnCheckInput" type="text" inputmode="text" autocomplete="off" maxlength="32" value="${escapeHtml(offer.observedIsbn || '')}" placeholder="ISBN-10 / ISBN-13" aria-label="ISBN do weryfikacji"><button class="button primary" type="button" id="reviewIsbnMatchButton">Uruchom dopasowanie</button><button class="button secondary" type="button" id="reviewIsbnCheckButton">Sprawdź ISBN</button><button class="button secondary" type="button" id="reviewExternalIsbnButton">BN / Open Library</button></div>
          <p id="reviewIsbnCheckResult" class="lean-review-result" role="status" aria-live="polite">Sprawdzenie nie zmienia przypisania. Pełne dopasowanie może zapisać zgodne wydanie i powiązanie; bez ISBN najpierw proponuje numery z API.</p>
          <div class="lean-review-title-lookup" ${offer.observedIsbn ? 'hidden' : ''}><input id="reviewTitleLookupInput" aria-label="Tytuł do wyszukania ISBN" value="${escapeHtml(offer.title || '')}" placeholder="Tytuł do wyszukania ISBN"><button id="reviewTitleLookupButton" class="button secondary" type="button">Znajdź ISBN po tytule</button></div>
          <div id="reviewTitleMatches" class="lean-review-title-matches" role="status" aria-live="polite"></div>
        </div>
        <section class="lean-review-match"><div class="lean-review-section-title"><strong>Proponowane wydanie</strong><span class="lean-review-match-status ${suggestedIsbnConflict ? 'is-conflict' : ''}">${suggestedIsbnConflict ? '⚠ Konflikt ISBN' : suggested && observedCandidateIsbn && suggestedIsbns.includes(observedCandidateIsbn) ? '✓ ISBN zgodny' : 'Weryfikacja wymagana'}</span></div><small class="lean-review-guidance">Sprawdź zgodność przed zatwierdzeniem.</small>
          ${suggested ? `<div class="lean-review-edition">
            <strong>${escapeHtml(suggested.work.title)}</strong>
            <div class="lean-review-edition-meta">
              <span><small>Wydawca</small>${escapeHtml(suggested.edition.publisher || 'Nieznany')}</span>
              <span><small>Język</small>${escapeHtml(suggested.edition.language || 'Brak danych — sprawdź ofertę')}</span>
              <span><small>ISBN wydania</small>${escapeHtml(suggestedIsbns.join(', ') || 'Brak')}</span>
            </div>
          </div>` : '<p class="lean-review-empty">Brak automatycznej propozycji. Dopasuj po ISBN lub wyszukaj inne wydanie.</p>'}
          <details class="lean-review-candidate"><summary>Dowody i porównanie metadanych</summary>${candidate}</details>
        </section>
        <section class="lean-review-choice"><details id="reviewManualChoice" class="lean-review-manual" ${suggested ? '' : 'open'}><summary>Przypisz do wydania — zmień / wyszukaj inne</summary>
          <div class="book-combobox"><input class="detail-select" id="reviewBookSearch" type="search" role="combobox" aria-controls="reviewBookOptions" aria-expanded="false" autocomplete="off" placeholder="Wpisz tytuł, autora lub ISBN" data-edition-id=""><div class="book-options" id="reviewBookOptions" role="listbox"></div></div>
        </details><p id="reviewChosenEdition" class="lean-review-selected" role="status" aria-live="polite"></p></section>
        <details class="lean-review-evidence"><summary>Dane oferty i diagnostyka</summary><div class="detail-grid"><span><b>Źródło</b><small>${escapeHtml(offer.source)}</small></span><span><b>ISBN z ogłoszenia</b><small>${escapeHtml(offer.observedIsbn || 'Brak')}</small></span><span><b>Klasyfikacja</b><small>${escapeHtml(evidence.map((row) => row.classification).join(', ') || 'brak dowodu')}</small></span><span><b>Ostatnio wykryto</b><small>${escapeHtml(date(offer.lastSeenAt))}</small></span></div><p class="lean-review-diagnostic">${escapeHtml(result.reason?.join?.(', ') || job.lastError || 'Brak dodatkowych informacji')}</p></details>
      </div>
      <footer class="lean-review-footer">
        <div class="lean-review-primary-actions"><button class="button primary" id="approveReview" type="button" disabled>Zatwierdź wydanie</button><div class="lean-review-reject"><select id="reviewRejectReason" aria-label="Powód odrzucenia"><option value="">Powód odrzucenia…</option><option value="wrong_language">Niewłaściwy język</option><option value="out_of_scope">Poza zakresem kolekcji</option><option value="not_book">To nie jest książka</option></select><button class="button secondary" id="rejectReview" type="button" disabled>Odrzuć ofertę</button></div></div>
        <div class="lean-review-secondary-actions"><details class="lean-review-more"><summary>Więcej działań</summary><div>${result.editionId ? '<button class="button secondary" id="rejectProposal" type="button">Odrzuć propozycję</button>' : ''}<button class="button secondary" id="markAsSet" type="button">Oznacz jako zestaw</button><button class="button secondary" id="requeueReview" type="button">Ponów identyfikację</button></div></details><span class="lean-review-shortcuts">Alt + ↑ / ↓: poprzednia / następna</span><div class="lean-review-navigation"><button class="button secondary" id="reviewPrev" type="button" aria-label="Poprzednia oferta">←</button><button class="button secondary" id="reviewNext" type="button" aria-label="Następna oferta">Następna →</button></div></div>
      </footer>
    </div>`;
  $('#approveReview').disabled = !$('#reviewBookSearch').dataset.editionId;
  const chosenEdition = $('#reviewChosenEdition');
  chosenEdition.textContent = suggested ? `Wybrane: ${suggested.work.title} — ${suggested.edition.title}` : 'Nie wybrano wydania.';
  const reviewPosition = filteredReviewOffers().findIndex((row) => row.id === job.id);
  $('#reviewPrev').disabled = reviewPosition <= 0;
  $('#reviewNext').disabled = reviewPosition < 0 || reviewPosition >= filteredReviewOffers().length - 1;
  $('#reviewBookSearch').addEventListener('input', (event) => {
    event.target.dataset.editionId = '';
    $('#approveReview').disabled = true;
    $('#reviewChosenEdition').textContent = 'Nie wybrano wydania.';
    $('#reviewBookOptions').classList.add('is-open');
    event.target.setAttribute('aria-expanded', 'true');
    renderReviewBookChoices(event.target.value);
    const query = event.target.value.trim();
    const reviewId = state.selectedReviewId;
    const requestId = ++reviewSearchRequest;
    if (reviewSearchTimer) clearTimeout(reviewSearchTimer);
    if (query.length < 2) return;
    reviewSearchTimer = setTimeout(async () => {
      try {
        const found = await json('/api/catalog/works?' + new URLSearchParams({ query, limit: '50' }));
        if (requestId !== reviewSearchRequest || state.selectedReviewId !== reviewId ||
            $('#reviewBookSearch') !== event.target || event.target.value.trim() !== query) return;
        renderReviewBookChoices(query, found.items || []);
      } catch (error) {
        if (requestId === reviewSearchRequest && state.selectedReviewId === reviewId)
          toast('Nie udało się wyszukać w SQLite: ' + error.message);
      }
    }, 300);
  });
  $('#reviewBookSearch').addEventListener('focus', (event) => {
    $('#reviewBookOptions').classList.add('is-open');
    event.target.setAttribute('aria-expanded', 'true');
    renderReviewBookChoices(event.target.value);
  });
  renderReviewBookChoices('');
  if (suggested) {
    const input = $('#reviewBookSearch');
    input.value = suggested.work.title;
    input.dataset.editionId = suggested.edition.id;
    input.setAttribute('aria-expanded', 'false');
    $('#reviewBookOptions').innerHTML = '';
    const proposedIsbn = normalizedIsbn(offer.observedIsbn);
    const editionIsbns = suggested.edition.identifiers
      .filter((item) => String(item.scheme).startsWith('isbn'))
      .map((item) => normalizedIsbn(item.value));
    $('#approveReview').disabled = Boolean(
      proposedIsbn && editionIsbns.length && !editionIsbns.includes(proposedIsbn),
    );
    if ($('#approveReview').disabled) {
      input.dataset.editionId = '';
      input.value = '';
      input.placeholder = 'Konflikt ISBN — wybierz wydanie ręcznie';
      chosenEdition.textContent = 'Konflikt ISBN — wybierz inne wydanie.';
    }
  }
  $('#reviewIsbnCheckInput').addEventListener('input', () => {
    $('#reviewBookSearch').dataset.editionId = '';
    $('#reviewChosenEdition').textContent = 'ISBN zmieniony — dopasuj ponownie.';
    $('#approveReview').disabled = true;
    $('#reviewIsbnCheckResult').textContent = 'ISBN zmieniony — dopasuj ponownie przed zatwierdzeniem.';
  });
  $('#reviewIsbnMatchButton').addEventListener('click', async () => {
    if (reviewDecisionPending) return;
    const button = $('#reviewIsbnMatchButton');
    const output = $('#reviewIsbnCheckResult');
    const isbn = $('#reviewIsbnCheckInput').value.trim();
    if (!isbn) {
      output.textContent = 'Brak ISBN w ofercie. Szukam propozycji numerów w BN / Open Library…';
      $('#reviewTitleLookupButton').click();
      return;
    }
    reviewDecisionPending = true;
    const controls = ['reviewIsbnMatchButton', 'reviewIsbnCheckInput', 'approveReview',
      'rejectReview', 'rejectProposal', 'markAsSet', 'requeueReview', 'reviewPrev', 'reviewNext']
      .map((id) => $('#' + id)).filter(Boolean);
    const previousDisabled = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    output.textContent = 'Dopasowuję ofertę z katalogiem i sprawdzam BN / Open Library…';
    try {
      const response = await json(`/api/identification-jobs/${encodeURIComponent(job.id)}/match-isbn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn }),
      });
      if (state.selectedReviewId !== job.id) return;
      if (response.matched) {
        state.selectedReviewId = null;
        state.reviewDetail = null;
        const refreshed = await loadCatalogData();
        toast(refreshed === false
          ? 'Dopasowano i zapisano w SQLite, ale odświeżenie listy się nie powiodło.'
          : response.decision === 'matched_existing'
            ? 'Oferta przypisana do istniejącego wydania.'
            : 'Utworzono wydanie w katalogu i przypisano ofertę.');
        return;
      }
      const reasons = {
        isbn_not_found_in_metadata_sources: 'Brak ISBN w Bibliotece Narodowej i Open Library.',
        metadata_source_temporary_error: 'Zewnętrzne API jest chwilowo niedostępne. Spróbuj ponownie.',
        metadata_sources_conflict: 'Źródła podają sprzeczne informacje. Weryfikacja ręczna jest konieczna.',
        offer_metadata_conflict: 'Dane ogłoszenia są sprzeczne z metadanymi książki.',
        offer_catalog_conflict: 'Dane ogłoszenia są sprzeczne z istniejącym wydaniem.',
        insufficient_offer_context: 'Za mało zgodnych informacji, żeby bezpiecznie przypisać ofertę.',
        metadata_invalid_or_incomplete: 'Metadane z zewnętrznych katalogów są niekompletne.',
        multiple_conflicting_isbn: 'Ogłoszenie ma sprzeczne numery ISBN.',
      };
      output.textContent = response.reason?.map((code) => reasons[code] || code).join(' · ')
        || 'Nie można bezpiecznie dopasować. Wybierz wydanie ręcznie.';
      $('#reviewManualChoice').open = true;
    } catch (error) {
      if (state.selectedReviewId === job.id)
        output.textContent = error.message === 'INVALID_ISBN'
          ? 'Nieprawidłowy ISBN — popraw numer i spróbuj ponownie.'
          : error.message === 'ISBN_REQUIRED'
            ? 'Wpisz ISBN lub wyszukaj wydanie ręcznie.'
            : 'Nie udało się dopasować: ' + error.message;
    } finally {
      reviewDecisionPending = false;
      controls.forEach((control, index) => {
        if (control.isConnected) control.disabled = previousDisabled[index];
      });
    }
  });
  $('#reviewTitleLookupButton').addEventListener('click', async () => {
    const button = $('#reviewTitleLookupButton');
    const output = $('#reviewTitleMatches');
    const title = $('#reviewTitleLookupInput').value.trim();
    if (title.length < 4) {
      output.textContent = 'Wpisz co najmniej cztery znaki tytułu.';
      return;
    }
    button.disabled = true;
    output.textContent = 'Szukam kandydatów ISBN po tytule…';
    try {
      const response = await json(`/api/identification-jobs/${encodeURIComponent(job.id)}/find-isbn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (state.selectedReviewId !== job.id) return;
      const candidates = response.candidates || [];
      output.innerHTML = candidates.length
        ? '<p>Wybierz właściwe wydanie i ISBN. Sam tytuł nie wystarcza do pewnego dopasowania:</p>' +
          candidates.map((candidate) =>
            `<button class="lean-review-title-option" type="button" data-title-isbn="${escapeHtml(candidate.isbn)}"><strong>${escapeHtml(candidate.title)}</strong><small>${escapeHtml(candidate.isbn)} · ${escapeHtml(candidate.source === 'bn' ? 'BN' : 'Open Library')} · ${escapeHtml(candidate.authors?.join(', ') || 'autor nieznany')} · ${escapeHtml(candidate.language || 'język nieznany')}</small></button>`,
          ).join('')
        : '<p>Nie znaleziono pewnych numerów ISBN dla tego tytułu. Możesz skrócić frazę lub wybrać wydanie ręcznie.</p>';
      if (response.unavailable?.length)
        output.insertAdjacentHTML('beforeend', '<p>Nie wszystkie źródła odpowiedziały. Wyniki mogą być niepełne.</p>');
      output.querySelectorAll('[data-title-isbn]').forEach((option) =>
        option.addEventListener('click', () => {
          $('#reviewIsbnCheckInput').value = option.dataset.titleIsbn;
          $('#reviewIsbnCheckInput').dispatchEvent(new Event('input', { bubbles: true }));
          $('#reviewIsbnMatchButton').click();
        }),
      );
    } catch (error) {
      if (state.selectedReviewId === job.id)
        output.textContent = 'Nie udało się wyszukać ISBN po tytule: ' + error.message;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  $('#reviewIsbnCheckButton').addEventListener('click', async () => {
    const button = $('#reviewIsbnCheckButton');
    const result = $('#reviewIsbnCheckResult');
    const isbn = $('#reviewIsbnCheckInput').value.trim();
    if (!isbn) {
      result.textContent = 'Wpisz ISBN przed sprawdzeniem.';
      return;
    }
    button.disabled = true;
    result.textContent = 'Sprawdzanie ISBN w lokalnym katalogu…';
    try {
      const response = await json('/api/catalog/isbn-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn }),
      });
      if (state.selectedReviewId !== job.id) return;
      result.textContent = response.found
        ? `Znaleziono w katalogu: ${response.edition.workTitle || response.edition.title} — wydanie: ${response.edition.title} (ISBN: ${response.isbn}). Aby przypisać ofertę, wybierz wydanie poniżej i zatwierdź decyzję.`
        : `ISBN ${response.isbn} nie występuje w lokalnym katalogu. To nie oznacza, że książka nie istnieje.`;
    } catch (error) {
      result.textContent = error.message === 'INVALID_ISBN'
        ? 'Nieprawidłowy ISBN — sprawdź cyfry i sumę kontrolną.'
        : `Nie udało się sprawdzić ISBN: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
  $('#reviewExternalIsbnButton').addEventListener('click', async () => {
    const button = $('#reviewExternalIsbnButton');
    const output = $('#reviewIsbnCheckResult');
    const isbn = $('#reviewIsbnCheckInput').value.trim();
    if (!isbn) {
      output.textContent = 'Wpisz ISBN przed sprawdzeniem.';
      return;
    }
    button.disabled = true;
    output.textContent = 'Sprawdzanie metadanych Biblioteki Narodowej i Open Library…';
    try {
      const response = await json('/api/catalog/lookup-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn }),
      });
      if (state.selectedReviewId !== job.id) return;
      output.innerHTML = metadataComparisonMarkup(response, escapeHtml);
    } catch (error) {
      if (state.selectedReviewId === job.id)
        output.textContent = 'Nie udało się pobrać metadanych: ' + error.message;
    } finally {
      button.disabled = false;
    }
  });
  $('#approveReview').addEventListener('click', approveReview);
  $('#reviewRejectReason').addEventListener('change', (event) => {
    $('#rejectReview').disabled = !event.target.value;
  });
  $('#rejectReview').addEventListener('click', () => {
    const reason = $('#reviewRejectReason').value;
    if (!reason) return;
    const labels = {
      wrong_language: 'Niewłaściwy język',
      out_of_scope: 'Poza zakresem kolekcji',
      not_book: 'To nie jest książka',
    };
    if (!confirm('Odrzucić ofertę? Powód: ' + labels[reason] + '.')) return;
    decideReview(reason === 'not_book' ? 'not_book' : 'excluded', null, labels[reason]);
  });
  $('#markAsSet').addEventListener('click', async () => {
    if (reviewDecisionPending) return;
    const current = state.selectedReviewId;
    const offerId = job.offerId;
    if (!current || !offerId || !confirm('Oznaczyć tę ofertę jako zestaw? Zniknie z weryfikacji pojedynczych książek.')) return;
    const button = $('#markAsSet');
    button.disabled = true;
    try {
      await json('/api/sets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId }),
      });
      if (state.selectedReviewId === current) {
        state.selectedReviewId = null;
        state.reviewDetail = null;
      }
      await loadCatalogData();
      toast('Zestaw zapisany. Książki dodasz w zakładce Zestawy.');
    } catch (error) {
      toast('Nie udało się oznaczyć zestawu: ' + error.message);
      if (button.isConnected) button.disabled = false;
    }
  });
  $('#reviewPrev').addEventListener('click', () => navigateReview(-1));
  $('#reviewNext').addEventListener('click', () => navigateReview(1));
  $('#requeueReview').addEventListener('click', () => decideReview('requeued'));
  $('#rejectProposal')?.addEventListener('click', () =>
    decideReview('proposal_rejected', result.editionId),
  );
}

function navigateReview(step) {
  const rows = filteredReviewOffers();
  const index = rows.findIndex((row) => row.id === state.selectedReviewId);
  const target = rows[index + step];
  if (!target || reviewDecisionPending) return;
  // The list only keeps the visible page in the DOM; load more when needed.
  if (!document.querySelector('[data-review-id="' + CSS.escape(target.id) + '"]')) {
    state.visibleRows.jobs = Math.max(state.visibleRows.jobs || 100, index + step + 1);
    renderReview();
  }
  document.querySelector('[data-review-id="' + CSS.escape(target.id) + '"]')?.click();
}

let reviewSearchRequest = 0;
let reviewSearchTimer = null;
function renderReviewBookChoices(query = '', works = state.catalogWorks) {
  const list = $('#reviewBookOptions'),
    input = $('#reviewBookSearch');
  if (!list || !input) return;
  const needle = query.trim().toLocaleLowerCase('pl');
  const editions = works
    .flatMap((work) => work.editions.map((edition) => ({ work, edition })))
    .filter(
      ({ work, edition }) =>
        !needle ||
        `${work.title} ${work.authors.join(' ')} ${edition.identifiers.map((row) => row.value).join(' ')}`
          .toLocaleLowerCase('pl')
          .includes(needle),
    )
    .slice(0, 30);
  list.innerHTML = editions.length
    ? editions
        .map(
          ({ work, edition }) =>
            `<button type="button" role="option" data-review-edition-id="${escapeHtml(edition.id)}" data-review-book-title="${escapeHtml(work.title)}"><strong>${escapeHtml(work.title)}</strong><small>${escapeHtml(edition.identifiers.find((row) => row.scheme.startsWith('isbn'))?.value || 'Bez ISBN')} - ${escapeHtml(edition.publisher || 'wydawca nieznany')}</small></button>`,
        )
        .join('')
    : '<p>Brak rekordów pasujących do wpisanej frazy.</p>';
  $$('[data-review-edition-id]').forEach((button) =>
    button.addEventListener('click', () => {
      input.value = button.dataset.reviewBookTitle;
      input.dataset.editionId = button.dataset.reviewEditionId;
      $('#reviewChosenEdition').textContent = `Wybrane ręcznie: ${button.dataset.reviewBookTitle}`;
      input.setAttribute('aria-expanded', 'false');
      list.innerHTML = '';
      list.classList.remove('is-open');
      $('#approveReview').disabled = false;
      input.focus();
    }),
  );
}

async function approveReview() {
  const editionId = $('#reviewBookSearch').dataset.editionId;
  if (!editionId) return;
  await decideReview('approved', editionId);
}

let reviewDecisionPending = false;
async function decideReview(action, editionId = null, reason = null) {
  const jobId = state.selectedReviewId;
  if (!jobId || reviewDecisionPending) return;
  reviewDecisionPending = true;
  const buttons = ['approveReview', 'rejectProposal', 'rejectReview', 'markAsSet', 'requeueReview']
    .map((id) => $('#' + id))
    .filter(Boolean);
  const disabledBefore = buttons.map((button) => button.disabled);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await json(`/api/identification-jobs/${encodeURIComponent(jobId)}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, editionId, reason }),
    });
    state.selectedReviewId = null;
    state.reviewDetail = null;
    const refreshed = await loadCatalogData();
    if (refreshed !== false) {
      const next = filteredReviewOffers()[0];
      if (next) {
        state.selectedReviewId = next.id;
        try {
          state.reviewDetail = await json(`/api/offers/${encodeURIComponent(next.offerId)}`);
        } catch {
          state.reviewDetail = null;
        }
        renderReview();
      }
    }
    toast(refreshed === false
      ? 'Decyzja zapisana w SQLite, ale nie udało się odświeżyć widoku.'
      : 'Decyzja została zapisana w historii SQLite.');
  } catch (error) {
    toast(`Nie udało się zapisać decyzji: ${error.message}`);
  } finally {
    reviewDecisionPending = false;
    buttons.forEach((button, index) => {
      if (button.isConnected) button.disabled = disabledBefore[index];
    });
  }
}

// Navigation shortcuts intentionally never submit decisions or capture typing fields.
document.addEventListener('keydown', (event) => {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const view = document.querySelector('#view-review');
  if (!view || view.hidden) return;
  if (event.target?.closest?.('input,select,textarea,[contenteditable="true"]')) return;
  event.preventDefault();
  navigateReview(event.key === 'ArrowDown' ? 1 : -1);
});

return { filteredReviewOffers, visibleCatalogRows, renderReview, normalizedIsbn, reviewCandidateMarkup, renderReviewDetail, renderReviewBookChoices, approveReview, decideReview };
}
