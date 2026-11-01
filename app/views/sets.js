// Local UI for multi-edition marketplace offers. No automatic pricing split.
export function createSetsView({ $, json, escapeHtml, toast }) {
  let sets = [];
  const request = (method, path, payload) => json(path, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(payload == null ? {} : { body: JSON.stringify(payload) }),
  });

  const selectOptions = (rows, value, label) => rows
    .map(row => `<option value="${escapeHtml(value(row))}">${escapeHtml(label(row))}</option>`).join('');

  async function refreshSets(preferred = null) {
    const response = await json('/api/sets');
    sets = response.items || [];
    const select = $('#setCurrent');
    const oldValue = preferred || select.value;
    select.innerHTML = selectOptions(sets, row => row.offerId,
      row => `${row.title} (${row.source}) — ${row.editions.length} książek`);
    if (sets.some(row => row.offerId === oldValue)) select.value = oldValue;
    renderMembers();
  }

  function renderMembers() {
    const active = sets.find(row => row.offerId === $('#setCurrent').value);
    const target = $('#setMembers');
    if (!active) {
      target.textContent = 'Brak zestawów. Najpierw wybierz ofertę i oznacz ją jako zestaw.';
      return;
    }
    target.innerHTML = `<h4>${escapeHtml(active.title)}</h4><p>Cena dotyczy całego zestawu, nie poszczególnych książek.</p>` +
      (active.editions.length ? active.editions.map(row =>
        `<div class="set-member"><span>${escapeHtml(row.workTitle)} — ${escapeHtml(row.title)}</span><button type="button" class="button secondary compact" data-set-remove="${escapeHtml(row.editionId)}">Usuń</button></div>`).join('')
        : '<p>Zestaw nie ma jeszcze przypisanych książek.</p>') +
      '<button type="button" class="button secondary" id="setUnmark">Usuń oznaczenie zestawu</button>';
    target.querySelectorAll('[data-set-remove]').forEach(button => button.addEventListener('click', async () => {
      try {
        await request('DELETE', '/api/sets/' + encodeURIComponent(active.offerId) +
          '/editions/' + encodeURIComponent(button.dataset.setRemove));
        await refreshSets(active.offerId);
      } catch (error) { toast(error.message); }
    }));
    $('#setUnmark').addEventListener('click', async () => {
      if (!confirm('Usunąć oznaczenie zestawu? Oferta wróci do kolejki identyfikacji.')) return;
      try {
        await request('DELETE', '/api/sets/' + encodeURIComponent(active.offerId));
        await refreshSets();
      } catch (error) { toast(error.message); }
    });
  }

  async function searchOffers() {
    const query = $('#setOfferQuery').value.trim();
    if (!query) { $('#setFeedback').textContent = 'Wpisz tytuł, ISBN lub źródło.'; return; }
    const found = await json('/api/offers?' + new URLSearchParams({query,limit:'100'}));
    $('#setOfferSelect').innerHTML = selectOptions(found.items || [], row => row.id,
      row => `${row.title} — ${row.source}`);
    $('#setFeedback').textContent = `Znaleziono ${found.total} ofert. Wybierz właściwą.`;
  }

  async function searchEditions() {
    const query = $('#setEditionQuery').value.trim();
    if (query.length < 2) { toast('Podaj co najmniej dwa znaki.'); return; }
    const found = await json('/api/catalog/works?' + new URLSearchParams({query,limit:'100'}));
    const editions = (found.items || []).flatMap(work =>
      work.editions.map(edition => ({id:edition.id, label: `${work.title} — ${edition.title} ${edition.publisher || ''}`})));
    $('#setEditionSelect').innerHTML = selectOptions(editions, row => row.id, row => row.label);
  }

  function wire(id, callback) {
    $(id).addEventListener('click', async () => {
      const button = $(id);
      button.disabled = true;
      try { await callback(); }
      catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    });
  }
  wire('#setSearchOffers', searchOffers);
  wire('#setSearchEditions', searchEditions);
  wire('#setMarkOffer', async () => {
    const offerId = $('#setOfferSelect').value;
    if (!offerId) return toast('Najpierw znajdź i wybierz ofertę.');
    await request('POST', '/api/sets', {offerId});
    await refreshSets(offerId);
    $('#setFeedback').textContent = 'Oferta jest teraz zestawem.';
  });
  wire('#setAddEdition', async () => {
    const offerId = $('#setCurrent').value, editionId = $('#setEditionSelect').value;
    if (!offerId || !editionId) return toast('Wybierz zestaw i wydanie książki.');
    await request('POST', '/api/sets/' + encodeURIComponent(offerId) + '/editions', {editionId});
    await refreshSets(offerId);
  });
  $('#setCurrent').addEventListener('change', renderMembers);
  return {refreshSets};
}
