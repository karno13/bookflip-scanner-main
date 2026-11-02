// Compact, bounded scan diagnostics. Never persist offer bodies or credentials.
export function createScanDiagnostics({ queries = [], sources = [], startedAt = new Date().toISOString() } = {}) {
  return {
    startedAt, totalTasks: queries.length * sources.length, completedTasks: 0,
    offersSeen: 0, retryCount: 0, errorCount: 0, active: null, lastActivityAt: startedAt,
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
    if (type === 'source-start' || type === 'page-start') diagnostics.active = { source: String(source).slice(0,70), query: String(query ?? '').slice(0,110), page: Number.isFinite(Number(page)) ? Number(page) : null };
    if (type === 'source-done' && diagnostics.active?.source === source) diagnostics.active = null;
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
    diagnostics.lastActivityAt = typeof at === 'string' ? at : new Date().toISOString();
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

export function scanTelemetry(diagnostics, { now = Date.now(), running = false } = {}) {
  const progress = scanProgress(diagnostics);
  const began = Date.parse(diagnostics?.startedAt ?? '');
  const elapsedSeconds = Number.isFinite(began) ? Math.max(0, Math.floor((now - began) / 1000)) : 0;
  const ratePerMinute = elapsedSeconds > 0
    ? Math.round((progress.completed / elapsedSeconds) * 60 * 10) / 10 : 0;
  // ETA is meaningful only with at least two observed completed tasks.
  const remaining = Math.max(0, progress.total - progress.completed);
  const etaSeconds = running && progress.completed >= 2 && ratePerMinute > 0
    ? Math.ceil(remaining / (ratePerMinute / 60)) : null;
  const activity = Date.parse(diagnostics?.lastActivityAt ?? '');
  const quietSeconds = running && Number.isFinite(activity)
    ? Math.max(0, Math.floor((now - activity) / 1000)) : 0;
  return {
    ...progress, elapsedSeconds, ratePerMinute, etaSeconds, quietSeconds,
    active: running ? diagnostics?.active ?? null : null,
    stalled: running && quietSeconds >= 120,
  };
}
