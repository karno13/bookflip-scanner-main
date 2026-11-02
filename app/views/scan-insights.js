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
      const telemetry = data.telemetry || {};
      const formatSeconds = seconds => {
        if (!Number.isFinite(seconds)) return '—';
        const value = Math.max(0, Math.floor(seconds));
        return value < 60 ? value + ' s' : Math.floor(value / 60) + ' min ' + String(value % 60).padStart(2, '0') + ' s';
      };
      const active = telemetry.active;
      $('#scanInsightsCurrent').textContent = active
        ? [active.source, active.query, active.page ? 'strona ' + active.page : ''].filter(Boolean).join(' · ')
        : (data.status === 'running' ? 'Oczekiwanie na następne zadanie' : 'Brak aktywnego zadania');
      $('#scanInsightsRate').textContent = Number(telemetry.ratePerMinute || 0).toLocaleString('pl-PL') + ' zadań/min';
      $('#scanInsightsEta').textContent = telemetry.etaSeconds == null ? 'Za mało danych' : 'około ' + formatSeconds(telemetry.etaSeconds);
      $('#scanInsightsElapsed').textContent = formatSeconds(telemetry.elapsedSeconds);
      $('#scanInsightsNotice').textContent = telemetry.stalled
        ? 'Brak nowych zdarzeń od co najmniej 2 minut. Sprawdź źródła i błędy poniżej.'
        : '';

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
        <span>${safe(explain(row.lastError) || row.status || 'pending')}</span></div>`).join('')
        : '<p>Brak rozpoczętego skanu.</p>';
      const codeLabels = {
        SOURCE_HTTP_403: 'Odmowa dostępu (403)', SOURCE_HTTP_429: 'Limit żądań (429)',
        SOURCE_CAPTCHA: 'Wymagana weryfikacja CAPTCHA', RATE_LIMIT: 'Ograniczenie tempa',
        PAGINATION_LOOP: 'Powtarzająca się strona', SOURCE_TIMEOUT: 'Przekroczony czas odpowiedzi',
      };
      const explain = code => codeLabels[code] || code;
      const events = (diagnostics.events || []).slice(-16).reverse();
      $('#scanInsightsEvents').innerHTML = events.length ? events.map(event =>
        `<div class="scan-insights-event"><span>${safe(event.type)}</span><strong>${safe(event.source)}</strong><small>${safe(explain(event.code) || event.query || '')}</small></div>`).join('')
        : '<p>Brak zdarzeń.</p>';
    } catch {
      $('#scanInsightsState').textContent = 'Brak połączenia';
    } finally {
      busy = false;
    }
  }
  return { refresh };
}
