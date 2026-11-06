import { readSearchStream } from '../scan-stream.js';

export async function requestScanCancellation({ $, toast }) {
  const button = $('#cancelSearch');
  button.disabled = true;
  button.textContent = 'Anulowanie…';
  try {
    const response = await fetch('/api/search/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw Error('CANCEL_HTTP_' + response.status);
    $('#scanGuardMessage').textContent = 'Trwa zatrzymywanie skanu. Wcześniej zapisane oferty pozostają w katalogu.';
  } catch (error) {
    toast('Nie udało się anulować skanu: ' + error.message);
    button.disabled = false;
    button.textContent = 'Anuluj skan';
  }
}


// Scanner view owns its progress state and UI; dependencies are injected by the shell.
export function createScannerView({ state, $, escapeHtml, shortTime, readQueries, selectedSources, toast, loadHistory, loadCatalogStatus, loadCatalogData, storage = globalThis.localStorage }) {
function resetScanUi(queries, sources, tasks = null) {
  state.scan.total = tasks?.length || queries.length * sources.length;
  state.scan.completed = 0;
  state.scan.rows = new Map();
  for (const source of sources)
    state.scan.rows.set(source, {
      source,
      status: 'Oczekuje',
      offers: 0,
      completed: 0,
      tasks: tasks ? tasks.filter(task=>task.source===source).length : queries.length,
      error: '',
      failures: 0,
      finishedAt: null,
    });
  $('#scanProgressPanel').hidden = false;
  $('#progressTrack').dataset.indeterminate = 'false';
  $('#progressBar').style.width = '0%';
  $('#scanStateBadge').textContent = 'Skanowanie';
  $('#scanStateBadge').className = 'state-badge warning';
  for (const id of ['statFound', 'statNew', 'statUpdated', 'statPriceChanges', 'statErrors'])
    $(`#${id}`).textContent = '0';
  renderSourceRows();
}

function renderSourceRows() {
  const rows = [...state.scan.rows.values()];
  $('#sourceStatusBody').innerHTML = rows.length
    ? rows
        .map(
          (row) =>
            `<tr><td><strong>${escapeHtml(row.source)}</strong><span class="offer-subtitle">${row.completed}/${row.tasks} zadań</span></td><td><span class="status-pill ${row.error ? 'error' : row.completed === row.tasks ? 'success' : row.status === 'Oczekuje' ? 'neutral' : 'warning'}">${escapeHtml(row.status)}</span></td><td>${row.offers}</td><td>-</td><td>${shortTime(row.finishedAt)}</td><td>${escapeHtml(row.error || '-')}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="empty-cell">Uruchom skan, aby zobaczyć statusy źródeł.</td></tr>';
}

function updateProgress(event) {
  const row = state.scan.rows.get(event.source);
  if (event.type === 'source-start' && row) {
    row.status = 'Skanowanie';
    $('#progressMessage').textContent = `${event.source}: ${event.query}`;
    $('#progressDetail').textContent = 'Łączenie ze źródłem';
  }
  if (event.type === 'page-start') {
    $('#progressMessage').textContent = `${event.source}: ${event.query}`;
    $('#progressDetail').textContent = `Pobieranie strony ${event.page}`;
  }
  if (event.type === 'page-done' && row) {
    $('#progressDetail').textContent = `Strona ${event.page}: ${event.count} ofert`;
  }
  if (event.type === 'language-progress')
    $('#progressDetail').textContent = `Weryfikacja języka ${event.checked}/${event.total}`;
  if (event.type === 'retry' && row) {
    row.status = 'Ponawianie';
    row.error = event.code || 'Błąd tymczasowy';
    $('#progressDetail').textContent = `Ponowienie ${event.attempt}/${event.maxAttempts}`;
  }
  if (event.type === 'source-error' && row) {
    row.failures += 1;
    row.error = event.code || 'SOURCE_ERROR';
    row.status = event.partial ? 'Częściowy' : 'Błąd';
  }
  if (event.type === 'source-done' && row) {
    row.completed += 1;
    row.offers += Number(event.offers || 0);
    if(event.status==='ok' && !row.failures) row.error='';
    row.status = row.failures ? 'Częściowy' :
      event.status === 'ok' && row.completed === row.tasks
        ? 'Zakończony'
        : event.status === 'ok'
          ? 'Skanowanie'
          : 'Częściowy';
    row.finishedAt = new Date().toISOString();
    state.scan.completed += 1;
  }
  const found = [...state.scan.rows.values()].reduce((sum, item) => sum + item.offers, 0);
  $('#statFound').textContent = found;
  $('#statErrors').textContent = [...state.scan.rows.values()].filter((item) => item.error).length;
  const percent = state.scan.total
    ? Math.min(100, Math.round((state.scan.completed / state.scan.total) * 100))
    : 0;
  $('#progressBar').style.width = `${percent}%`;
  $('#progressDetail').textContent += ` - ${state.scan.completed}/${state.scan.total} zadań`;
  renderSourceRows();
}

async function startSearch(options = {}) {
  if (state.scan.running) return;
  const tasks = Array.isArray(options.tasks) ? options.tasks : null;
  const queries = tasks ? [...new Set(tasks.map(task=>task.query))] : readQueries(),
    sources = tasks ? [...new Set(tasks.map(task=>task.source))] : selectedSources();
  if (!queries.length) return toast('Dodaj przynajmniej jedną frazę.');
  if (queries.length > 10) return toast('Wpisano '+queries.length+' fraz. Maksymalnie 10 — usuń nadmiar lub podziel je na profile.');
  if (!sources.length) return toast('Wybierz przynajmniej jedno źródło.');
  const fingerprint = JSON.stringify({ queries, sources: [...sources].sort() });
  if (state.scan.fingerprint === fingerprint && Date.now() - state.scan.lastStart < 5000)
    return toast('Ten sam skan został przed chwila uruchomiony.');
  state.scan.running = true;
  state.scan.fingerprint = fingerprint;
  state.scan.lastStart = Date.now();
  state.scan.startedAt = Date.now();
  try {
    storage.setItem('bookflip-search', JSON.stringify({ queries, sources }));
  } catch {
    // Storage may be unavailable; scanning should still work.
  }
  resetScanUi(queries, sources, tasks);
  $('#startSearch').disabled = true;
  $('#cancelSearch').hidden = false;
  $('#cancelSearch').disabled = false;
  $('#cancelSearch').textContent = 'Anuluj skan';
  $('#startSearch').textContent = 'Skanowanie...';
  $('#scanGuardMessage').textContent = 'Skan trwa na serwerze także po zamknięciu karty. Aby go zatrzymać, kliknij Anuluj skan.';
  state.scan.timer = setInterval(() => {
    $('#progressElapsed').textContent =
      `${Math.floor((Date.now() - state.scan.startedAt) / 1000)} s`;
  }, 1000);
  try {
    const response = await fetch('/api/search?stream=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries, sources, ...(tasks ? {tasks} : {}) }),
    });
    if (!response.ok) throw Error(`SEARCH_HTTP_${response.status}`);
    state.scan.result = await readSearchStream(response, updateProgress);
    state.scan.completed = state.scan.total;
    $('#progressBar').style.width = '100%';
    $('#progressMessage').textContent = 'Skan zakończony';
    const summary = state.scan.result.summary || {},
      last = state.scan.result.lastScan || {};
    $('#statFound').textContent = summary.offers || last.found || 0;
    $('#statNew').textContent = summary.newOffers || last.newOffers || 0;
    $('#statUpdated').textContent = Math.max(0, (summary.offers || 0) - (summary.newOffers || 0));
    $('#statPriceChanges').textContent = summary.priceChanges || last.priceChanges || 0;
    $('#statErrors').textContent = (state.scan.result.results || []).filter(
      (row) => row.status !== 'ok',
    ).length;
    const problems=(state.scan.result.results || []).filter(row=>row.status!=='ok').length;
    $('#progressMessage').textContent=problems ? `Zapisano ${summary.offers || 0} ofert; ${problems} zadań z problemami` : `Zapisano ${summary.offers || 0} ofert`;
    document.dispatchEvent(new CustomEvent('bookflip-scan-complete'));
    $('#scanStateBadge').textContent = problems ? 'Zakończony z problemami' : 'Zakończony';
    $('#scanStateBadge').className = problems ? 'state-badge warning' : 'state-badge neutral';
    $('#goToOffers').disabled = false;
    await Promise.all([loadHistory(), loadCatalogStatus(), loadCatalogData()]);
    renderSourceRows();
    toast(`Skan zakończony: ${summary.offers || 0} ofert.`);
  } catch (error) {
    if (error.message === 'SCAN_CANCELLED') {
      $('#progressMessage').textContent = 'Skan anulowany';
      $('#progressDetail').textContent = 'Nowe wyniki z anulowanego skanu nie zostały zapisane.';
      $('#scanStateBadge').textContent = 'Anulowany';
      $('#scanStateBadge').className = 'state-badge neutral';
      toast('Skan został anulowany.');
      return;
    }
    $('#progressMessage').textContent = 'Nie udało się potwierdzić zakończenia skanu';
    $('#progressDetail').textContent = error.message;
    $('#scanStateBadge').textContent = 'Błąd';
    $('#scanStateBadge').className = 'state-badge warning';
    toast(`Nie udało się wykonac skanu: ${error.message}`);
  } finally {
    clearInterval(state.scan.timer);
    state.scan.running = false;
    $('#cancelSearch').hidden = true;
    $('#startSearch').disabled = false;
    $('#startSearch').textContent = 'Uruchom skan';
    $('#scanGuardMessage').textContent = '';
  }
}


  if(typeof document!=='undefined') document.addEventListener('bookflip-retry-scan',event=>{void startSearch({tasks:event.detail});});
  return { startSearch, resetScanUi, renderSourceRows, updateProgress };
}
