// Compact, bounded scan diagnostics. Never persist offer bodies or credentials.
export function createScanDiagnostics({ queries = [], sources = [], startedAt = new Date().toISOString() } = {}) {
  return {
    startedAt, totalTasks: queries.length * sources.length, completedTasks: 0,
    offersSeen: 0, retryCount: 0, errorCount: 0,
    sources: Object.fromEntries(sources.map(source => [source, {
      completed: 0, offers: 0, retries: 0, errors: 0, status: 'pending', lastError: null,
    }])),
    events: [],
  };
}
export function addScanEvent(diagnostics, event) {
  if (!diagnostics || !event || typeof event !== 'object') return diagnostics;
  const { type, source, query, page, code, status, offers, count, at } = event;
  const row = diagnostics.sources[source];
  if (row) {
    if (type === 'source-start' || type === 'page-start') row.status = 'running';
    if (type === 'retry') { row.retries++; diagnostics.retryCount++; row.status = 'retrying'; }
    if (type === 'source-error') {
      row.errors++; diagnostics.errorCount++;
      row.lastError = typeof code === 'string' ? code.slice(0, 100) : 'SOURCE_ERROR';
      row.status = 'error';
    }
    if (type === 'source-done') {
      row.completed++; diagnostics.completedTasks++;
      const observed = Math.max(0, Number(offers) || 0);
      row.offers += observed; diagnostics.offersSeen += observed;
      row.status = status === 'ok' ? 'completed' : 'partial';
    }
  }
  const selected = ['source-start', 'page-start', 'page-done', 'retry', 'source-error', 'source-done'];
  if (selected.includes(type)) {
    diagnostics.events.push({
      at: typeof at === 'string' ? at : new Date().toISOString(),
      type, source: String(source ?? '').slice(0, 70),
      query: String(query ?? '').slice(0, 110),
      page: Number.isFinite(Number(page)) ? Number(page) : null,
      code: typeof code === 'string' ? code.slice(0, 100) : null,
      count: Math.max(0, Number(count) || 0),
    });
    if (diagnostics.events.length > 60) diagnostics.events.splice(0, diagnostics.events.length - 60);
  }
  return diagnostics;
}
export function scanProgress(diagnostics) {
  const total = diagnostics?.totalTasks || 0;
  const completed = diagnostics?.completedTasks || 0;
  return { completed, total, percent: total ? Math.min(100, Math.round(completed / total * 100)) : null };
}
