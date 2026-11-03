// Lightweight data for the app shell. Preserve the full /api/history endpoint for legacy callers.
// Only labels for actively linked editions are needed for offer-list fallbacks.
export function historyBookLabels(repository) {
  const rows = repository.database.prepare(`
    SELECT DISTINCT
      COALESCE(e.legacy_id,w.legacy_id,'edition:' || e.id) AS book_id,
      e.title AS title
    FROM offer_matches m
    JOIN editions e ON e.id = m.edition_id
    JOIN works w ON w.id = e.work_id
    WHERE m.status = 'active'
    ORDER BY book_id
  `).all();
  const seen = new Set();
  const books = [];
  for (const row of rows) {
    if (seen.has(row.book_id)) continue;
    seen.add(row.book_id);
    books.push({ book: { id: row.book_id, title: row.title } });
  }
  return { books };
}
