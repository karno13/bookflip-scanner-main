// "Suspicious assignments" panel in the catalogue: offers filed under an edition only because of
// their ISBN, whose listing title shares no word with that edition. Usually the seller typed the
// ISBN of another book. Each row is one operator decision: keep (it is right) or send to review.
export function mountTitleConflicts({ $, json, escapeHtml, toast, loadCatalogData }) {
  const panel = $('#catalogConflicts');
  const body = $('#catalogConflictsBody');
  if (!panel || !body) return { refresh() {} };
  let busy = false;
  let conflicts = [];

  const safeHref = (url) => (/^https?:\/\//i.test(String(url ?? '')) ? url : '#');
  const shortTitle = (title) => String(title ?? '').split(' / ')[0];

  const rowMarkup = (item, index) =>
    `<article class="conflict-row">
      <div class="conflict-pair">
        <span><a href="${escapeHtml(safeHref(item.url))}" target="_blank" rel="noreferrer">${escapeHtml(item.offerTitle)}</a></span>
        <small>${escapeHtml(item.source)}${item.isbn ? ` · ISBN ${escapeHtml(item.isbn)}` : ''}</small>
        <span class="conflict-arrow">przypisane do</span>
        <span><b>${escapeHtml(shortTitle(item.editionTitle))}</b></span>
      </div>
      <div class="conflict-actions">
        <button class="button secondary" type="button" data-conflict="${index}" data-action="review">Do weryfikacji</button>
        <button class="button ghost" type="button" data-conflict="${index}" data-action="confirm">To prawidłowe</button>
      </div>
    </article>`;

  function setSummary() {
    panel.querySelector('summary').textContent = conflicts.length
      ? `Podejrzane przypisania (${conflicts.length})`
      : 'Podejrzane przypisania';
  }

  async function refresh() {
    body.innerHTML = '<p class="inline-note">Sprawdzam zgodność tytułów…</p>';
    try {
      ({ conflicts } = await json('/api/catalog/title-conflicts'));
      setSummary();
      if (!conflicts.length) {
        body.innerHTML = '<p class="inline-note">Każda przypisana oferta ma w tytule coś wspólnego ze swoim wydaniem.</p>';
        return;
      }
      body.innerHTML =
        '<p class="inline-note">Tytuł ogłoszenia nie ma ani jednego wspólnego słowa z wydaniem, do którego trafiło po ISBN — najczęściej sprzedający wpisał numer innej książki. „Do weryfikacji” cofa przypisanie i wraca ofertę do kolejki; „To prawidłowe” zostawia je na stałe.</p>' +
        conflicts.map(rowMarkup).join('');
    } catch (error) {
      body.innerHTML = `<p class="inline-note">Nie udało się sprawdzić przypisań: ${escapeHtml(error.message)}</p>`;
    }
  }

  body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-conflict]');
    if (!button || busy) return;
    const item = conflicts[Number(button.dataset.conflict)];
    if (!item) return;
    busy = true;
    button.closest('.conflict-row').querySelectorAll('button').forEach((control) => { control.disabled = true; });
    try {
      await json('/api/catalog/title-conflicts/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId: item.offerId, action: button.dataset.action }),
      });
      toast(button.dataset.action === 'review' ? 'Cofnięto przypisanie — oferta czeka w weryfikacji.' : 'Zostawiono przypisanie.');
      await loadCatalogData();
      await refresh();
    } catch (error) {
      toast('Nie zapisano decyzji: ' + error.message);
      await refresh();
    } finally {
      busy = false;
    }
  });

  // The count is useful before the panel is opened: fetch it once on start.
  void json('/api/catalog/title-conflicts')
    .then((data) => {
      conflicts = data.conflicts;
      setSummary();
      panel.hidden = !conflicts.length;
    })
    .catch(() => {});
  panel.addEventListener('toggle', () => {
    if (panel.open) void refresh();
  });
  return { refresh };
}
