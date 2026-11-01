export function createSettingsView({ state, $, escapeHtml, loadCatalogStatus, fetcher = fetch, clock = performance }) {
function renderSettings() {
  if (!state.catalog) loadCatalogStatus();
}
async function runDiagnostics() {
  const button = $('#runDiagnostics');
  button.disabled = true;
  $('#diagnosticResults').innerHTML =
    '<div class="diagnostic-result"><strong>Trwa test...</strong><small>Lokalne endpointy</small></div>';
  const checks = [
    ['Zrodla', '/api/sources'],
    ['Historia SQLite', '/api/history'],
    ['Katalog SQLite', '/api/catalog/status'],
  ];
  try {
  const results = await Promise.all(
    checks.map(async ([name, url]) => {
      const started = clock.now();
      try {
        const response = await fetcher(url);
        return {
          name,
          ok: response.ok,
          ms: Math.round(clock.now() - started),
          code: response.status,
        };
      } catch {
        return { name, ok: false, ms: Math.round(clock.now() - started), code: 'ERR' };
      }
    }),
  );
  $('#diagnosticResults').innerHTML = results
    .map(
      (result) =>
        `<div class="diagnostic-result"><strong>${escapeHtml(result.name)} - ${result.ok ? 'OK' : 'BLAD'}</strong><small>${result.code} / ${result.ms} ms</small></div>`,
    )
    .join('');
  } finally {
    button.disabled = false;
  }
}


return { renderSettings, runDiagnostics };
}
