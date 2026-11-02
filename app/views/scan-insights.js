// Read-only diagnostics for a local scan. Fields come from /api/scan/diagnostics.
export function createScanInsights({ $, json, escapeHtml }) {
  const safe = value => escapeHtml(String(value ?? ''));
  let busy = false;
  let lastState = '';
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const data = await json('/api/scan/diagnostics');
      const diagnostics = data.diagnostics || {};
      const progress = data.progress || {};
      const state = data.status || 'idle';
      $('#scanInsightsState').textContent = ({
        running: 'Skan trwa', completed: 'Zakończony', failed: 'Błąd',
        interrupted: 'Przerwany', idle: 'Gotowy',
      })[state] || state;
      $('#scanInsightsTasks').textContent = `${progress.completed || 0} / ${progress.total || 0}`;
      $('#scanInsightsOffers').textContent = Number(diagnostics.offersSeen || 0);
      $('#scanInsightsRetries').textContent = Number(diagnostics.retryCount || 0);
      $('#scanInsightsErrors').textContent = Number(diagnostics.errorCount || 0);
      $('#scanInsightsPercent').textContent = progress.percent == null ? '—' : progress.percent + '%';
      $('#scanInsightsBar').value = progress.percent || 0;
      if (state === 'running' && lastState !== 'running' && diagnostics.startedAt) {
        $('#scanProgressPanel').hidden = false;
      }
      lastState = state;
      const rows = Object.entries(diagnostics.sources || {});
      $('#scanInsightsSources').innerHTML = rows.length ? rows.map(([name, row]) =>
        `<div class="scan-insights-row"><strong>${safe(name)}</strong><small>${Number(row.completed || 0)} zadań · ${Number(row.offers || 0)} ofert · ${Number(row.retries || 0)} ponowień</small>
        <span>${safe(row.lastError || row.status || 'pending')}</span></div>`).join('')
        : '<p>Brak rozpoczętego skanu.</p>';
      const events = (diagnostics.events || []).slice(-16).reverse();
      $('#scanInsightsEvents').innerHTML = events.length ? events.map(event =>
        `<div class="scan-insights-event"><span>${safe(event.type)}</span><strong>${safe(event.source)}</strong><small>${safe(event.code || event.query || '')}</small></div>`).join('')
        : '<p>Brak zdarzeń.</p>';
    } catch {
      $('#scanInsightsState').textContent = 'Brak połączenia';
    } finally {
      busy = false;
    }
  }
  return { refresh };
}
