// Pure helpers for view <-> URL mapping. Kept free of DOM so they are unit-testable.
export const VIEWS = ['scanner', 'review', 'catalog', 'sets', 'offers', 'settings'];

export function viewFromSearch(search) {
  const name = new URLSearchParams(search || '').get('view');
  return VIEWS.includes(name) ? name : 'scanner';
}

// Selected item (book, review job, set) for views that have a list + detail layout.
export const ITEM_VIEWS = ['catalog', 'review', 'sets'];

export function idFromSearch(search) {
  const id = new URLSearchParams(search || '').get('id');
  return id && id.length <= 200 ? id : null;
}

export function urlForView(name, id = null) {
  if (name === 'scanner' || !VIEWS.includes(name)) return '/';
  const base = '/?view=' + name;
  return id && ITEM_VIEWS.includes(name) ? base + '&id=' + encodeURIComponent(id) : base;
}

// True when navigating to `name` must add a history entry: the visible URL differs
// from the target and this is not the initial render.
export function shouldPush(currentUrl, name, initial) {
  // Compare views only: selecting an item inside a view must not create a new entry.
  const current = currentUrl.split('#')[0];
  const [path, query = ''] = current.split('?');
  return !initial && urlForView(viewFromSearch('?' + query)) !== urlForView(name);
}
