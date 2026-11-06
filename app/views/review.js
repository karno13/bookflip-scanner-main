import { openDetailView } from '../core/detail-navigation.js';
import {statusLabel,allowDiscard} from '../core/ux.js';
import { safeOfferHref } from '../core/formatters.js';
// review workspace, preserving existing behavior while isolating its implementation.
export function createReviewView({ state, $, $$, json, toast, money, date, escapeHtml, reviewOffers, loadCatalogData, renderCatalog, openCatalogForReview }) {
function filteredReviewOffers() {
  const query = $('#reviewSearch').value.trim().toLocaleLowerCase('pl'),
    source = $('#reviewSource').value,
    isbn = $('#reviewIsbn').value;
  const rows = reviewOffers().filter((job) => {
    if(state.skippedReviewIds?.has(job.id)) return false;
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
          return `<button class="review-item ${job.id === state.selectedReviewId ? 'active' : ''}" type="button" aria-current="${job.id === state.selectedReviewId ? 'true' : 'false'}" data-review-id="${escapeHtml(job.id)}"><span class="book-spine" aria-hidden="true">▤</span><span><strong>${escapeHtml(offer.title)}</strong><small>${escapeHtml(offer.source)} - ${offer.observedIsbn ? `ISBN ${escapeHtml(offer.observedIsbn)}` : 'brak ISBN'}</small><small>${escapeHtml(statusLabel(job.status))}${job.lastError ? ' — pobieranie wymaga ponowienia' : ''}</small></span><span class="review-price">${money(offer.currentPrice)}</span></button>`;
        })
        .join('')
    : '<div class="empty-detail"><h3>Brak pozycji</h3><p>Filtry nie zwracaja ofert wymagajacych decyzji.</p></div>';
  $('#reviewList').scrollTop = reviewListScroll;
  $$('[data-review-id]').forEach((button) =>
    button.addEventListener('click', async () => {
      state.selectedReviewId = button.dataset.reviewId;
  openDetailView('review');
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
    result = job.result || {};
  const pendingEditionId = state.reviewPendingEdition?.jobId === job.id
    ? state.reviewPendingEdition.editionId : null;
  const suggested = (pendingEditionId || result.editionId)
    ? state.catalogWorks
        .flatMap((w) => w.editions.map((e) => ({ work: w, edition: e })))
        .find((x) => x.edition.id === (pendingEditionId || result.editionId))
    : null;
  if (pendingEditionId && suggested) state.reviewPendingEdition = null;
  $('#reviewDetail').innerHTML =
    `<div class="lean-review simple-review">
      <header class="lean-review-header">
        <h3>${escapeHtml(offer.title)}</h3>
        <a href="${escapeHtml(safeOfferHref(offer.url))}" target="_blank" rel="noreferrer">Ogłoszenie ↗</a>
      </header>
      <div class="lean-review-body">
        <section class="lean-review-isbn">
          <label for="reviewIsbnCheckInput">ISBN</label>
          <div class="lean-review-isbn-tools"><input id="reviewIsbnCheckInput" type="text" inputmode="text" autocomplete="off" maxlength="32" value="${escapeHtml(offer.observedIsbn || '')}" placeholder="ISBN-10 / ISBN-13"><button class="button secondary" type="button" id="reviewIsbnMatchButton">Sprawdź ISBN</button></div>
          <p id="reviewIsbnCheckResult" class="lean-review-result" role="status" aria-live="polite"></p>
        </section>
        <section class="lean-review-choice">
          <label for="reviewBookSearch">Pozycja z katalogu</label>
          <div class="book-combobox"><input class="detail-select" id="reviewBookSearch" type="search" role="combobox" aria-controls="reviewBookOptions" aria-expanded="false" autocomplete="off" placeholder="Szukaj po tytule, autorze lub ISBN" data-edition-id=""><div class="book-options" id="reviewBookOptions" role="listbox"></div></div>
          <p id="reviewChosenEdition" class="lean-review-selected" role="status" aria-live="polite"></p>
        </section>
      </div>
      <footer class="lean-review-footer">
        <div class="lean-review-primary-actions"><button class="button primary" id="approveReview" type="button" disabled>Zatwierdź</button><button class="button secondary" id="rejectReview" type="button">Odrzuć</button></div>
        <div class="lean-review-secondary-actions"><button class="button secondary" id="markAsSet" type="button">Oznacz jako zestaw</button><button class="button secondary" id="reviewAddEdition" type="button">Dodaj do katalogu</button></div>
      </footer>
    </div>`;
  $('#approveReview').disabled = !$('#reviewBookSearch').dataset.editionId;
  const chosenEdition = $('#reviewChosenEdition');
  chosenEdition.textContent = suggested ? `Wybrane: ${suggested.work.title} — ${suggested.edition.title}` : 'Nie wybrano wydania.';
  const reviewPosition = filteredReviewOffers().findIndex((row) => row.id === job.id);
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
  let returningFromOptions = false;
  $('#reviewBookSearch').addEventListener('focus', (event) => {
    if (returningFromOptions) { returningFromOptions = false; return; }
    $('#reviewBookOptions').classList.add('is-open');
    event.target.setAttribute('aria-expanded', 'true');
    renderReviewBookChoices(event.target.value);
  });
  $('#reviewBookSearch').addEventListener('keydown',event=>{
    const options=[...$('#reviewBookOptions').querySelectorAll('[role="option"]')];
    if(event.key==='ArrowDown'&&options.length){event.preventDefault();options[0].focus();}
    if(event.key==='Escape'){$('#reviewBookOptions').classList.remove('is-open');event.target.setAttribute('aria-expanded','false');}
  });
  $('#reviewBookOptions').addEventListener('keydown',event=>{
    const options=[...event.currentTarget.querySelectorAll('[role="option"]')];const index=options.indexOf(document.activeElement);
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();options[Math.max(0,Math.min(options.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus();}
    if(event.key==='Escape'){event.preventDefault();$('#reviewBookOptions').classList.remove('is-open');$('#reviewBookSearch').setAttribute('aria-expanded','false');returningFromOptions=true;$('#reviewBookSearch').focus();}
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
  let pendingIsbn=null;
  $('#reviewIsbnCheckInput').addEventListener('input', () => {
    pendingIsbn=null;
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
    pendingIsbn=null;
    if (reviewSearchTimer) clearTimeout(reviewSearchTimer);
    reviewSearchRequest++;
    $('#reviewBookOptions').classList.remove('is-open');
    $('#reviewBookOptions').innerHTML = '';
    $('#reviewBookSearch').setAttribute('aria-expanded', 'false');
    $('#approveReview').disabled=true;
    if (!isbn) {
      output.textContent = 'Wpisz ISBN lub wybierz pozycję z katalogu.';
      return;
    }
    reviewDecisionPending = true;
    const controls = ['reviewIsbnMatchButton', 'reviewIsbnCheckInput', 'approveReview',
      'rejectReview', 'rejectProposal', 'markAsSet', 'requeueReview', 'reviewPrev', 'reviewNext']
      .map((id) => $('#' + id)).filter(Boolean);
    const previousDisabled = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    output.textContent = 'Sprawdzam katalog. Jeśli brak wpisu — sprawdzę API…';
    try {
      const response = await json(`/api/identification-jobs/${encodeURIComponent(job.id)}/match-isbn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn, preview:true }),
      });
      if (state.selectedReviewId !== job.id) return;
      if (response.canConfirm) {
        if (response.source === 'catalog' && response.candidate) {
          const input = $('#reviewBookSearch');
          input.value = response.candidate.title;
          input.dataset.editionId = response.editionId;
          input.setAttribute('aria-expanded', 'false');
          $('#reviewBookOptions').innerHTML = '';
          output.textContent = 'Znaleziono w katalogu: ' + response.candidate.title;
          $('#reviewChosenEdition').textContent = 'Wybrano z katalogu: ' + response.candidate.title;
          return;
        }
        pendingIsbn=isbn;
        $('#approveReview').disabled=false;
        output.textContent='Znaleziono zgodne wydanie. Nic nie przypisano. Sprawdź dane i zatwierdź poniżej.';

        if(response.candidate) output.textContent='Propozycja: '+response.candidate.title+' · '+(response.candidate.authors?.join(', ') || 'autor nieznany')+' · '+(response.candidate.publisher || 'wydawca nieznany')+' · '+(response.candidate.publicationYear || 'rok nieznany')+' · '+(response.candidate.language || 'język nieznany')+' · ISBN '+isbn+'. Nic nie przypisano — zatwierdź wydanie.';
        $('#reviewChosenEdition').textContent='Wybrano propozycję dla ISBN '+isbn+'; oczekuje na zatwierdzenie.';
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
      $('#approveReview').disabled = !pendingIsbn && !$('#reviewBookSearch').dataset.editionId;
    }
  });
  $('#reviewBookSearch').addEventListener('input',()=>{pendingIsbn=null;});
  $('#reviewBookOptions').addEventListener('click',()=>{pendingIsbn=null;});
  $('#approveReview').addEventListener('click',async()=>{
    if(!pendingIsbn) return approveReview();
    if(reviewDecisionPending) return;
    reviewDecisionPending=true;$('#approveReview').disabled=true;
    try {
      const result=await json('/api/identification-jobs/'+encodeURIComponent(job.id)+'/match-isbn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({isbn:pendingIsbn,confirm:true})});
      if(!result.matched) {$('#reviewIsbnCheckResult').textContent='Dane zmieniły się od podglądu. Wyszukaj i sprawdź wydanie ponownie.';pendingIsbn=null;return;}
      state.selectedReviewId=null;state.reviewDetail=null;await loadCatalogData();
      const rows=filteredReviewOffers();const next=rows[Math.min(Math.max(reviewPosition,0),rows.length-1)];
      if(next){state.selectedReviewId=next.id;renderReview();}
      toast('Zatwierdzono wydanie i zapisano decyzję.');
    }catch(error){toast('Nie zapisano przypisania. Sprawdź dane i spróbuj ponownie.');}
    finally{reviewDecisionPending=false;if($('#approveReview'))$('#approveReview').disabled=false;}
  });
  $('#reviewAddEdition').addEventListener('click',()=>{
    openCatalogForReview({ jobId: job.id, isbn: $('#reviewIsbnCheckInput').value });
  });
  $('#rejectReview').addEventListener('click', () => decideReview('excluded', null, 'Odrzucono podczas weryfikacji.'));
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
  const position=filteredReviewOffers().findIndex(row=>row.id===jobId);
  reviewDecisionPending = true;
  const buttons = ['approveReview', 'rejectProposal', 'rejectReview', 'markAsSet', 'requeueReview']
    .map((id) => $('#' + id))
    .filter(Boolean);
  const disabledBefore = buttons.map((button) => button.disabled);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const saved = await json(`/api/identification-jobs/${encodeURIComponent(jobId)}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, editionId, reason }),
    });
    state.selectedReviewId = null;
    state.reviewDetail = null;
    const refreshed = await loadCatalogData();
    if (refreshed !== false) {
      const after=filteredReviewOffers();
      const next = after[Math.min(Math.max(position,0),after.length-1)];
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
    if (action === 'excluded' && refreshed !== false) {
      toast('Oferta została odrzucona.', {
        label: 'Cofnij',
        onClick: async () => {
          const reopened = await json(`/api/review-decisions/${encodeURIComponent(saved.decision.id)}/reopen`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
          });
          await loadCatalogData();
          state.selectedReviewId = reopened.jobId;
          state.reviewDetail = null;
          renderReview();
        },
        onError: () => toast('Nie udało się cofnąć decyzji. Oferta mogła zostać już zmieniona.'),
      });
    } else toast(refreshed === false
      ? 'Decyzja zapisana w SQLite, ale nie udało się odświeżyć widoku.'
      : 'Zapisano decyzję. Możesz ją poprawić w historii decyzji.');
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
