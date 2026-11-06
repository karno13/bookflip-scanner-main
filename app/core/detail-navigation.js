// Presentation only: keep mounted forms intact when returning to the list.
const panes = {
  review: ['.split-workspace', '#reviewDetail', '#reviewList', 'Weryfikacja'],
  catalog: ['.catalog-layout', '#catalogDetail', '#catalogList', 'Katalog'],
  sets: ['.sets-workspace', '.sets-main', '#setList', 'Zestawy'],
};
const positions = new Map();
const triggers = new Map();

export function openDetailView(name) {
  if (!window.matchMedia('(max-width: 900px)').matches) return;
  const view = document.querySelector('#view-' + name);
  if (!view || !panes[name]) return;
  if (!view.classList.contains('detail-is-open')) {
    positions.set(name, window.scrollY);
    triggers.set(name, document.activeElement);
  }
  view.classList.add('detail-is-open');
  view.querySelector('.detail-back')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

export function installDetailNavigation() {
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
      view.classList.remove('detail-is-open');
      const trigger = triggers.get(name);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      window.scrollTo({ top: positions.get(name) || 0, behavior: 'instant' });
    });
    layout.before(back);
  }
}
