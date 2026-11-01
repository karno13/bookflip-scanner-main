// Workspace for marketplace offers containing multiple catalog editions.
export function createSetsView({ $, json, escapeHtml, toast }) {
  let sets = [];
  let activeId = null;
  let searchSerial = 0;
  const request = (method, path, body) => json(path, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const safe = (value) => escapeHtml(String(value ?? ''));
  const plural = (count) => count === 1 ? '1 książka' : `${count} książek`;

  function renderList() {
    const needle = $('#setFilter').value.trim().toLocaleLowerCase('pl');
    const rows = sets.filter(item => `${item.title} ${item.source}`.toLocaleLowerCase('pl').includes(needle));
    $('#setTotal').textContent = pluralSets(sets.length);
    $('#setList').innerHTML = rows.length ? rows.map(item => `
      <button class="sets-list-item ${item.offerId === activeId ? 'active' : ''}" type="button"
        data-set-id="${safe(item.offerId)}" aria-pressed="${item.offerId === activeId}">
        <span class="sets-list-title">${safe(item.title)}</span>
        <span class="sets-list-meta"><span>${safe(item.source)}</span><span>${plural(item.editions.length)}</span></span>
      </button>`).join('') : '<p class="sets-empty">Brak zestawów pasujących do wyszukiwania.</p>';
    $('#setList').querySelectorAll('[data-set-id]').forEach(button => {
      button.addEventListener('click', () => selectSet(button.dataset.setId));
    });
  }
  function pluralSets(count) { return count === 1 ? '1 zestaw' : `${count} zestawów`; }

  function selectSet(id) {
    activeId = id;
    $('#setCurrent').value = id || '';
    renderList();
    renderMembers();
  }

  async function refreshSets(preferred = null) {
    const response = await json('/api/sets');
    sets = response.items || [];
    const selected = preferred || activeId;
    activeId = sets.some(item => item.offerId === selected) ? selected : sets[0]?.offerId || null;
    $('#setCurrent').innerHTML = sets.map(item =>
      `<option value="${safe(item.offerId)}">${safe(item.title)}</option>`).join('');
    $('#setCurrent').value = activeId || '';
    renderList();
    renderMembers();
  }

  function renderMembers() {
    const active = sets.find(item => item.offerId === activeId);
    $('#setSelectedTitle').textContent = active?.title || 'Wybierz zestaw z listy';
    $('#setSelectedMeta').textContent = active ? `Źródło: ${active.source} · Cena dotyczy całego zestawu` : 'Zawartość zestawu pojawi się tutaj.';
    $('#setSelectedCount').textContent = plural(active?.editions.length || 0);
    $('#setMemberHint').textContent = active?.editions.length ? 'Powiązane wydania z katalogu' : 'Brak przypisanych wydań';
    const target = $('#setMembers');
    if (!active) {
      target.innerHTML = '<p class="sets-empty">Wybierz zestaw po lewej stronie lub utwórz nowy.</p>';
      return;
    }
    const rows = active.editions.map((item, index) => `
      <div class="sets-member">
        <span class="sets-member-index" aria-hidden="true">${index + 1}</span>
        <div class="sets-member-copy"><strong>${safe(item.workTitle)}</strong>
          <small>${safe(item.title)}</small></div>
        <button class="button secondary" type="button" data-set-remove="${safe(item.editionId)}"
          aria-label="Usuń ${safe(item.title)} z zestawu">Usuń</button>
      </div>`).join('');
    target.innerHTML = (rows || '<p class="sets-empty">Ten zestaw nie ma jeszcze książek. Wyszukaj wydanie poniżej i dodaj je jednym kliknięciem.</p>') +
      '<div class="sets-footer"><button class="button secondary" type="button" id="setUnmark">Usuń oznaczenie zestawu</button></div>';
    target.querySelectorAll('[data-set-remove]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await request('DELETE', '/api/sets/' + encodeURIComponent(active.offerId) +
          '/editions/' + encodeURIComponent(button.dataset.setRemove));
        await refreshSets(active.offerId);
      } catch (error) { button.disabled = false; toast(error.message); }
    }));
    $('#setUnmark').addEventListener('click', async () => {
      if (!confirm('Usunąć oznaczenie zestawu? Oferta wróci do kolejki identyfikacji.')) return;
      try { await request('DELETE', '/api/sets/' + encodeURIComponent(active.offerId)); await refreshSets(); }
      catch (error) { toast(error.message); }
    });
  }

  async function searchOffers() {
    const query = $('#setOfferQuery').value.trim();
    if (!query) { $('#setFeedback').textContent = 'Wpisz tytuł lub ISBN oferty.'; return; }
    const found = await json('/api/offers?' + new URLSearchParams({ query, limit: '100' }));
    $('#setOfferSelect').innerHTML = (found.items || []).map(row =>
      `<option value="${safe(row.id)}">${safe(row.title)} — ${safe(row.source)}</option>`).join('');
    $('#setFeedback').textContent = `Znaleziono ${found.total} ofert.`;
  }

  async function searchEditions() {
    const query = $('#setEditionQuery').value.trim();
    const output = $('#setEditionResults');
    if (query.length < 2) { output.textContent = 'Wpisz co najmniej 2 znaki.'; return; }
    const serial = ++searchSerial;
    output.textContent = 'Wyszukiwanie w katalogu…';
    try {
      const response = await json('/api/catalog/works?' + new URLSearchParams({ query, limit: '100' }));
      if (serial !== searchSerial) return;
      const rows = (response.items || []).flatMap(work => (work.editions || []).map(edition =>
        ({ id: edition.id, work: work.title, title: edition.title, publisher: edition.publisher || '' })));
      const current = sets.find(item => item.offerId === activeId);
      const included = new Set((current?.editions || []).map(item => item.editionId));
      $('#setEditionSelect').innerHTML = rows.map(row => `<option value="${safe(row.id)}">${safe(row.title)}</option>`).join('');
      output.innerHTML = rows.length ? rows.map(row => `
        <div class="sets-result">
          <div><strong>${safe(row.work)}</strong><small>${safe(row.title)}${row.publisher ? ' · ' + safe(row.publisher) : ''}</small></div>
          <button type="button" class="button ${included.has(row.id) ? 'secondary' : 'primary'}"
            data-add-edition="${safe(row.id)}" ${included.has(row.id) ? 'disabled' : ''}>${included.has(row.id) ? 'Dodano' : 'Dodaj'}</button>
        </div>`).join('') : '<p class="sets-empty">Nie znaleziono wydań. Spróbuj innego tytułu lub ISBN.</p>';
      output.querySelectorAll('[data-add-edition]').forEach(button => button.addEventListener('click', async () => {
        if (!activeId) return toast('Najpierw wybierz zestaw.');
        button.disabled = true;
        try {
          await request('POST', '/api/sets/' + encodeURIComponent(activeId) + '/editions', { editionId: button.dataset.addEdition });
          button.textContent = 'Dodano';
          await refreshSets(activeId);
        } catch (error) { button.disabled = false; toast(error.message); }
      }));
    } catch (error) {
      if (serial === searchSerial) output.textContent = 'Nie udało się wyszukać książek: ' + error.message;
    }
  }
  function wire(id, callback) {
    $(id).addEventListener('click', async () => {
      const button = $(id);
      button.disabled = true;
      try { await callback(); } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    });
  }
  wire('#setSearchOffers', searchOffers);
  wire('#setSearchEditions', searchEditions);
  wire('#setMarkOffer', async () => {
    const offerId = $('#setOfferSelect').value;
    if (!offerId) return toast('Najpierw wyszukaj i wybierz ofertę.');
    await request('POST', '/api/sets', { offerId });
    await refreshSets(offerId);
    $('#setFeedback').textContent = 'Zestaw utworzony.';
    const details = $('#setOfferQuery').closest('details');
    if (details) details.open = false;
  });
  $('#setFilter').addEventListener('input', renderList);
  $('#setCurrent').addEventListener('change', () => selectSet($('#setCurrent').value));
  $('#setEditionQuery').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); void searchEditions(); }
  });
  $('#setOfferQuery').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); void searchOffers().catch(error => toast(error.message)); }
  });
  return { refreshSets };
}
