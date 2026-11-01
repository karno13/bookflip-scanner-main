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
  if (view) {
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
  $('#reviewList').innerHTML = rows.length
    ? visibleCatalogRows('jobs', rows)
        .map((job) => {
          const offer = job.offer;
          return `<button class="review-item ${job.id === state.selectedReviewId ? 'active' : ''}" type="button" data-review-id="${escapeHtml(job.id)}"><span class="book-spine" aria-hidden="true">▤</span><span><strong>${escapeHtml(offer.title)}</strong><small>${escapeHtml(offer.source)} - ${offer.observedIsbn ? `ISBN ${escapeHtml(offer.observedIsbn)}` : 'brak ISBN'}</small><small>${escapeHtml(job.status)}${job.lastError ? ` - ${escapeHtml(job.lastError)}` : ''}</small></span><span class="review-price">${money(offer.currentPrice)}</span></button>`;
        })
        .join('')
    : '<div class="empty-detail"><h3>Brak pozycji</h3><p>Filtry nie zwracaja ofert wymagajacych decyzji.</p></div>';
  $$('[data-review-id]').forEach((button) =>
    button.addEventListener('click', async () => {
      state.selectedReviewId = button.dataset.reviewId;
      state.reviewDetail = null;
      renderReview();
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
  renderReviewDetail();
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
  if (!job)
    return ($('#reviewDetail').innerHTML =
      '<div class="empty-detail"><h3>Wybierz ofertę</h3><p>Po lewej pojawia się lista ofert wymagajacych decyzji.</p></div>');
  const offer = state.reviewDetail || job.offer,
    evidence = state.reviewDetail?.evidence || [],
    result = job.result || {};
  const suggested = result.editionId
    ? state.catalogWorks
        .flatMap((w) => w.editions.map((e) => ({ work: w, edition: e })))
        .find((x) => x.edition.id === result.editionId)
    : null;
  const candidate = reviewCandidateMarkup(offer, suggested);

  $('#reviewDetail').innerHTML =
    `<section class="detail-section"><div class="book-detail-title"><div><span class="status-pill warning">${escapeHtml(job.status)}</span><h3>${escapeHtml(offer.title)}</h3></div><strong>${money(offer.currentPrice)}</strong></div><a href="${escapeHtml(offer.url)}" target="_blank" rel="noreferrer">Otwórz oryginalne ogłoszenie</a></section><section class="detail-section"><h4>Dane oferty i dowody</h4><details class="detail-disclosure"><summary>Jak sprawdzić dopasowanie?</summary><p class="inline-note">Dopasowanie dotyczy konkretnego wydania, nie tylko podobnego tytułu. Sprawdź ISBN i źródło przed zatwierdzeniem.</p></details><div class="detail-grid"><span><b>Źródło</b><small>${escapeHtml(offer.source)}</small></span><span><b>ISBN</b><small>${escapeHtml(offer.observedIsbn || 'Nie wykryto')}</small></span><span><b>Klasyfikacja ISBN</b><small>${escapeHtml(evidence.map((row) => row.classification).join(', ') || 'brak dowodu')}</small></span><span><b>Ostatnio wykryto</b><small>${escapeHtml(date(offer.lastSeenAt))}</small></span></div><p class="inline-note">${escapeHtml(result.reason?.join?.(', ') || job.lastError || 'Wybierz właściwe wydanie albo oznacz ofertę jako nie-książkę.')}</p></section><section class="detail-section"><h4>Sprawdź ISBN w lokalnym katalogu</h4><div class="isbn-check-row"><label class="field"><span>ISBN z oferty lub wpisany ręcznie</span><input id="reviewIsbnCheckInput" type="text" inputmode="text" autocomplete="off" maxlength="32" value="${escapeHtml(offer.observedIsbn || '')}" placeholder="ISBN-10 lub ISBN-13"></label><button class="button secondary" type="button" id="reviewIsbnCheckButton">Sprawdź ISBN</button><button class="button secondary" type="button" id="reviewExternalIsbnButton">Sprawdź BN / Open Library</button></div><p id="reviewIsbnCheckResult" class="inline-note" role="status" aria-live="polite">Sprawdzenie nie zmienia przypisania ani danych katalogu.</p></section><section class="detail-section review-comparison"><h4>Proponowane wydanie</h4><details class="detail-disclosure"><summary>O automatycznej propozycji</summary><p class="inline-note">Sprawdź porównanie przed zatwierdzeniem. Automatyczna propozycja nie jest ostateczną decyzją.</p></details>${candidate}</section><section class="detail-section"><h4>Wybierz wydanie i zdecyduj</h4><details class="detail-disclosure"><summary>Co zmieni ta decyzja?</summary><p class="inline-note">Decyzja zmieni przypisanie tej oferty w lokalnym katalogu. Nie zmienia dostępności ogłoszenia ani jego ceny.</p></details><div class="book-combobox"><input class="detail-select" id="reviewBookSearch" type="search" role="combobox" aria-controls="reviewBookOptions" aria-expanded="true" autocomplete="off" placeholder="Wpisz tytuł, autora lub ISBN" data-edition-id=""><div class="book-options" id="reviewBookOptions" role="listbox"></div></div><div class="detail-actions"><button class="button primary" id="approveReview" type="button" disabled>Zatwierdź przypisanie</button>${result.editionId ? '<button class="button secondary" id="rejectProposal" type="button">Odrzuć propozycję</button>' : ''}<button class="button secondary" id="markNotBook" type="button">Oznacz jako nie-książkę</button><button class="button secondary" id="markAsSet" type="button">Oznacz jako zestaw</button><button class="button secondary" id="requeueReview" type="button">Ponów identyfikację</button></div></section>`;
  $('#approveReview').disabled = !$('#reviewBookSearch').dataset.editionId;
  $('#reviewBookSearch').addEventListener('input', (event) => {
    event.target.dataset.editionId = '';
    $('#approveReview').disabled = true;
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
  $('#reviewBookSearch').addEventListener('focus', (event) =>
    renderReviewBookChoices(event.target.value),
  );
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
    }
  }
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
  $('#markNotBook').addEventListener('click', () => decideReview('not_book'));
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
  $('#requeueReview').addEventListener('click', () => decideReview('requeued'));
  $('#rejectProposal')?.addEventListener('click', () =>
    decideReview('proposal_rejected', result.editionId),
  );
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
      input.setAttribute('aria-expanded', 'false');
      list.innerHTML = '';
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
async function decideReview(action, editionId = null) {
  const jobId = state.selectedReviewId;
  if (!jobId || reviewDecisionPending) return;
  reviewDecisionPending = true;
  const buttons = ['approveReview', 'rejectProposal', 'markNotBook', 'markAsSet', 'requeueReview']
    .map((id) => $('#' + id))
    .filter(Boolean);
  const disabledBefore = buttons.map((button) => button.disabled);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await json(`/api/identification-jobs/${encodeURIComponent(jobId)}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, editionId }),
    });
    state.selectedReviewId = null;
    state.reviewDetail = null;
    const refreshed = await loadCatalogData();
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

return { filteredReviewOffers, visibleCatalogRows, renderReview, normalizedIsbn, reviewCandidateMarkup, renderReviewDetail, renderReviewBookChoices, approveReview, decideReview };
}
