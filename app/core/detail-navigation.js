// Presentation only: keep mounted forms intact when returning to the list.
const panes = {
  review: ['.split-workspace', '#reviewDetail', '#reviewList', 'Weryfikacja'],
  catalog: ['.catalog-layout', '#catalogDetail', '#catalogList', 'Katalog'],
  sets: ['.sets-workspace', '.sets-main', '#setList', 'Zestawy'],
};
const positions = new Map();
const triggers = new Map();

function closeDetail(name) {
  const view = document.querySelector('#view-' + name);
  if (!view?.classList.contains('detail-is-open')) return;
  view.classList.remove('detail-is-open');
  const trigger = triggers.get(name);
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  window.scrollTo({ top: positions.get(name) || 0, behavior: 'instant' });
}

export function openDetailView(name) {
  if (!window.matchMedia('(max-width: 900px)').matches) return;
  const view = document.querySelector('#view-' + name);
  if (!view || !panes[name]) return;
  if (!view.classList.contains('detail-is-open')) {
    positions.set(name, window.scrollY);
    triggers.set(name, document.activeElement);
    // One history entry per opened detail, so the system Back button returns to the list first.
    const hist = globalThis.history;
    hist?.pushState?.({ ...(hist.state || {}), detail: name }, '', globalThis.location?.href);
  }
  view.classList.add('detail-is-open');
  view.querySelector('.detail-back')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

export function installDetailNavigation() {
  // Any history entry without a detail marker means the list is the target: close every open detail.
  window.addEventListener?.('popstate', (event) => {
    for (const name of Object.keys(panes)) if (event.state?.detail !== name) closeDetail(name);
  });
  for (const [name, [layoutSelector, , , label]] of Object.entries(panes)) {
    const view = document.querySelector('#view-' + name);
    const layout = view?.querySelector(layoutSelector);
    if (!layout) continue;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'detail-back button secondary';
    back.textContent = 'Wróć do listy';
    back.setAttribute('aria-label', 'Wróć do listy: ' + label);
    back.addEventListener('click', () => {
      // Going through history keeps the stack consistent; popstate performs the actual close.
      if (globalThis.history?.state?.detail === name) globalThis.history.back();
      else closeDetail(name);
    });
    layout.before(back);
  }
}

