// "Possible duplicate works" panel in the catalogue: reprints of one book that ended up as
// separate works. The server proposes strict groups (same title and first author); merging a
// group is one confirmed action per group and keeps editions and offers.
import { confirmDialog } from '../core/dialogs.js';

export function mountDuplicates({ $, json, escapeHtml, toast, loadCatalogData }) {
  const panel = $('#catalogDuplicates');
  const body = $('#catalogDuplicatesBody');
  if (!panel || !body) return { refresh() {} };
  let busy = false;

  const groupMarkup = (group, index) => {
    const target = group.works.find((work) => work.id === group.targetId);
    const rows = group.works
      .map(
        (work) =>
          `<li${work.id === group.targetId ? ' class="is-target"' : ''}><span>${escapeHtml(work.title.split(' / ')[0])}</span><small>${escapeHtml(
            work.authors[0] || 'autor nieznany',
          )} · ${work.editions} wyd. · ${work.offers} ofert${work.id === group.targetId ? ' · zostaje' : ''}</small></li>`,
      )
      .join('');
    return `<article class="duplicate-group"><ul>${rows}</ul><button class="button secondary" type="button" data-merge-group="${index}" aria-label="Połącz ${group.works.length} dzieł w „${escapeHtml(
      target.title.split(' / ')[0],
    )}”">Połącz w jedno</button></article>`;
  };

  async function refresh() {
    body.innerHTML = '<p class="inline-note">Szukam duplikatów…</p>';
    try {
      const { groups } = await json('/api/catalog/work-duplicates');
      panel.querySelector('summary').textContent = groups.length
        ? `Możliwe duplikaty dzieł (${groups.length})`
        : 'Możliwe duplikaty dzieł';
      if (!groups.length) {
        body.innerHTML = '<p class="inline-note">Nie znaleziono dzieł o tym samym tytule i autorze.</p>';
        return;
      }
      body.innerHTML =
        '<p class="inline-note">Te dzieła mają ten sam tytuł i pierwszego autora, więc to najpewniej dodruki jednej książki. Połączenie przenosi wszystkie wydania pod jedno dzieło.</p>' +
        groups.map(groupMarkup).join('');
      body.querySelectorAll('[data-merge-group]').forEach((button) =>
        button.addEventListener('click', () => merge(groups[Number(button.dataset.mergeGroup)], button)),
      );
    } catch (error) {
      body.innerHTML = `<p class="inline-note">Nie udało się wczytać duplikatów: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function merge(group, button) {
    if (busy) return;
    const target = group.works.find((work) => work.id === group.targetId);
    const sources = group.works.filter((work) => work.id !== group.targetId);
    const confirmed = await confirmDialog(
      `Połączyć ${sources.length} ${sources.length === 1 ? 'dzieło' : 'dzieła'} w „${target.title.split(' / ')[0]}”? Wydania i oferty zostaną przeniesione, a historia decyzji zachowana.`,
      { title: 'Połączenie dzieł', confirmLabel: 'Połącz', danger: true },
    );
    if (!confirmed) return;
    busy = true;
    button.disabled = true;
    try {
      await json('/api/catalog/work-duplicates/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: group.targetId, sourceIds: sources.map((work) => work.id) }),
      });
      toast('Połączono dzieła.');
      await loadCatalogData();
      await refresh();
    } catch (error) {
      toast('Nie udało się połączyć: ' + error.message);
      button.disabled = false;
    } finally {
      busy = false;
    }
  }

  let loaded = false;
  panel.addEventListener('toggle', () => {
    if (panel.open && !loaded) {
      loaded = true;
      void refresh();
    }
  });
  return { refresh };
}
