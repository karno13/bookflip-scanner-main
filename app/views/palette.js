// Command palette (Ctrl+K): jump to a view, run a frequent action, or find an offer / work / ISBN.
import { coverMarkup, tidyOfferTitle, tidyWorkTitle, parseBnPeople } from '../core/bibliography.js';

export function installCommandPalette({ $, json, escapeHtml, money, showView, openOfferDrawer, openWork, actions = [] }) {
  const dialog = $('#commandPalette');
  const input = $('#paletteInput');
  const results = $('#paletteResults');
  if (!dialog || !input || !results) return;
  const views = [
    ['scanner', 'Skaner', 'Skanowanie i stan katalogu'],
    ['review', 'Do weryfikacji', 'Kolejka decyzji'],
    ['catalog', 'Katalog', 'Dzieła i wydania'],
    ['offers', 'Oferty', 'Wszystkie zebrane ogłoszenia'],
    ['sets', 'Zestawy', 'Oferty z wieloma książkami'],
    ['settings', 'Ustawienia', 'Interfejs, kopie, diagnostyka'],
  ];
  let items = [];
  let active = 0;
  let serial = 0;
  let timer = null;
  const fold = (text) => String(text).toLocaleLowerCase('pl').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

  function staticItems(query) {
    const needle = fold(query.trim());
    const list = [
      ...views.map(([view, label, hint]) => ({ group: 'Przejdź', label, hint, run: () => showView(view) })),
      ...actions.map((action) => ({ group: 'Akcja', ...action })),
    ];
    return needle ? list.filter((item) => fold(item.label + ' ' + (item.hint || '')).includes(needle)) : list;
  }

  function render() {
    let lastGroup = '';
    results.innerHTML = items.length
      ? items
          .map((item, index) => {
            const header = item.group !== lastGroup ? `<div class="palette-group">${escapeHtml(item.group)}</div>` : '';
            lastGroup = item.group;
            return `${header}<button type="button" role="option" class="palette-item${index === active ? ' is-active' : ''}" aria-selected="${index === active}" data-index="${index}">${item.cover !== undefined ? coverMarkup(item.cover, item.label, { size: 'xs', escapeHtml }) : '<span class="palette-icon" aria-hidden="true">›</span>'}<span class="palette-copy"><b>${escapeHtml(item.label)}</b>${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ''}</span>${item.meta ? `<span class="palette-meta">${escapeHtml(item.meta)}</span>` : ''}</button>`;
          })
          .join('')
      : '<p class="palette-empty">Brak wyników.</p>';
    results.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  async function search(query) {
    const request = ++serial;
    items = staticItems(query);
    active = 0;
    render();
    const text = query.trim();
    if (text.length < 2) return;
    try {
      const [offers, works] = await Promise.all([
        json('/api/offers?' + new URLSearchParams({ query: text, limit: '6' })),
        json('/api/catalog/works?' + new URLSearchParams({ query: text, limit: '6' })),
      ]);
      if (request !== serial) return;
      items = [
        ...items,
        ...(works.items || []).map((work) => ({
          group: 'Katalog',
          label: tidyWorkTitle(work.title),
          hint: parseBnPeople((work.authors || []).join(' '), work.authors).join(', ') || `${work.editionCount} wydań`,
          meta: `${work.offerCount} ofert`,
          cover: work.cover || null,
          run: () => openWork(work.id),
        })),
        ...(offers.items || []).map((offer) => ({
          group: 'Oferty',
          label: tidyOfferTitle(offer.title),
          hint: `${offer.source}${offer.observedIsbn ? ' · ISBN ' + offer.observedIsbn : ''}`,
          meta: money(offer.currentPrice),
          cover: offer.image || null,
          run: () => openOfferDrawer(offer.id),
        })),
      ];
      render();
    } catch {
      // Static entries stay usable when search fails.
    }
  }

  function open() {
    if (dialog.open) return;
    input.value = '';
    dialog.showModal();
    void search('');
    input.focus();
  }
  function choose(index) {
    const item = items[index];
    if (!item) return;
    dialog.close();
    item.run();
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    items = staticItems(input.value);
    active = 0;
    render();
    timer = setTimeout(() => void search(input.value), 220);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(0, Math.min(items.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
      render();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    }
  });
  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-index]');
    if (button) choose(Number(button.dataset.index));
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (dialog.open) dialog.close();
      else open();
    }
  });
  return { open };
}
