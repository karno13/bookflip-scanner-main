// Shared, dependency-free browser helpers. Keep DOM code in the view modules.
export function readSavedSearch(storage) {
  try {
    const value = JSON.parse(storage.getItem('bookflip-search') || 'null');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? {
          queries: Array.isArray(value.queries) ? value.queries.filter((q) => typeof q === 'string') : [],
          sources: Array.isArray(value.sources) ? value.sources.filter((s) => typeof s === 'string') : [],
        }
      : null;
  } catch {
    return null;
  }
}

export function validateCatalogPage(data, limit, offset) {
  if (
    !data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) ||
    data.total < 0 || !Number.isSafeInteger(limit) || limit < 1 ||
    data.items.length > limit || offset > data.total ||
    (data.items.length === 0 && offset < data.total) ||
    offset + data.items.length > data.total
  ) throw Error('INVALID_CATALOG_PAGE');
  return data;
}
