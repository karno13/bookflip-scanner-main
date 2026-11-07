import { json } from '../core/api.js';
import { escapeHtml } from '../core/formatters.js';

// Scanner home: how much of the collected market data is already identified, how good each source
// is, and how far each followed series (scan phrase) has been catalogued.
export function installDashboard({ state, showView }) {
  const scanner = document.querySelector('#view-scanner');
  if (!scanner || document.querySelector('#workflowDashboard')) return () => {};
  const panel = document.createElement('section');
  panel.id = 'workflowDashboard';
  panel.className = 'panel insight-board';
  panel.setAttribute('aria-label', 'Stan katalogu');
  panel.innerHTML = '<p class="inline-note">Wczytywanie stanu katalogu…</p>';
  const anchor = scanner.querySelector('.stats-grid');
  if (anchor) anchor.before(panel);
  else scanner.append(panel);

  let backfillTimer = null;
  let backfillWasRunning = false;
  function backfillMarkup(status) {
    if (status.state === 'running')
      return `<span class="inline-note">Uzupełniam zdjęcia: ${status.done}/${status.total} · znaleziono ${status.filled}${status.waitingSources?.length ? ` · ${escapeHtml(status.waitingSources.join(', '))} prosi o wolniejsze tempo, czekam` : ''}</span>${bar(status.total ? (status.done / status.total) * 100 : 0)}<button type="button" class="button secondary compact" data-backfill="cancel">Zatrzymaj</button>`;
    const summary = status.finishedAt
      ? `Ostatnio: ${status.filled} nowych zdjęć${status.skippedSources.length ? ' · pominięte (blokada): ' + escapeHtml(status.skippedSources.join(', ')) : ''}`
      : 'Starsze oferty nie mają zdjęć — pobiorę je z ogłoszeń w tle, w tempie bezpiecznym dla serwisów.';
    return `<span class="inline-note">${summary}</span><button type="button" class="button secondary compact" data-backfill="start">Uzupełnij zdjęcia</button>`;
  }
  async function backfillTick() {
    clearTimeout(backfillTimer);
    let status;
    try {
      status = await json('/api/images/backfill');
    } catch {
      return;
    }
    const box = panel.querySelector('#photoBackfill');
    if (box) box.innerHTML = backfillMarkup(status);
    const running = status.state === 'running';
    if (running) backfillTimer = setTimeout(backfillTick, 2000);
    else if (backfillWasRunning) void refresh();
    backfillWasRunning = running;
  }

  panel.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-backfill]');
    if (action) {
      action.disabled = true;
      try {
        await json('/api/images/backfill' + (action.dataset.backfill === 'cancel' ? '/cancel' : ''), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      } catch {
        // The status line below shows the real state either way.
      }
      backfillWasRunning = true;
      void backfillTick();
      return;
    }
    const target = event.target.closest('[data-go]');
    if (!target) return;
    showView(target.dataset.go);
    // A series row jumps to its group in the review queue (grouped by scan phrase).
    if (target.dataset.query) {
      const sort = document.querySelector('#reviewSort');
      if (sort && sort.value !== 'group') {
        sort.value = 'group';
        sort.dispatchEvent(new Event('change'));
      }
      const wanted = target.dataset.query.toLocaleLowerCase('pl');
      setTimeout(() => {
        const header = [...document.querySelectorAll('#reviewList .rv-group span')].find(
          (node) => node.textContent.toLocaleLowerCase('pl') === wanted,
        );
        header?.parentElement?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, 600);
    }
  });

  const bar = (value, tone = '') =>
    `<span class="mini-bar${tone ? ' is-' + tone : ''}" data-pct="${Math.max(0, Math.min(100, Math.round(value / 5) * 5))}"><i></i></span>`;
  const rate = (value) => `${String(value).replace('.', ',')}%`;

  async function refresh() {
    let data;
    try {
      data = await json('/api/catalog/insights');
    } catch {
      panel.innerHTML = '<p class="inline-note">Nie udało się odczytać stanu katalogu. Użyj „Odśwież”.</p>';
      return;
    }
    const f = data.funnel;
    const steps = [
      ['Zebrane oferty', f.offers, 'offers', 'wszystkie źródła'],
      ['Z numerem ISBN', f.withIsbn, 'offers', `${rate(f.offers ? Math.round((f.withIsbn / f.offers) * 1000) / 10 : 0)} ofert`],
      ['W katalogu', f.matched, 'catalog', `${f.manual} zatwierdzonych ręcznie`],
      ['Czeka na decyzję', f.review, 'review', `${f.queued} w kolejce automatu`],
    ];
    const top = Math.max(1, f.offers);
    panel.innerHTML = `
      <div class="insight-head">
        <div><p class="section-eyebrow">STAN KATALOGU</p><h3>Od oferty do rozpoznanego wydania</h3></div>
        <button type="button" class="button primary compact" data-go="review">Weryfikuj ${f.review ? `(${f.review})` : ''}</button>
      </div>
      <ol class="funnel">${steps
        .map(
          ([label, value, view, note], index) =>
            `<li><button type="button" data-go="${view}" class="funnel-step${index === 3 ? ' is-attention' : ''}"><span class="funnel-label">${label}</span><strong>${value.toLocaleString('pl-PL')}</strong><small>${escapeHtml(note)}</small>${bar((value / top) * 100, index === 3 ? 'warn' : '')}</button></li>`,
        )
        .join('')}</ol>
      <div class="insight-grid">
        <section>
          <h4>Serie i frazy</h4>
          <ul class="series-progress">${
            data.series.length
              ? data.series
                  .map(
                    (item) =>
                      `<li><button type="button" data-go="review" data-query="${escapeHtml(item.phrase)}"><span class="series-name">${escapeHtml(item.phrase)}</span><span class="series-meta">${item.matched}/${item.offers} w katalogu${item.review ? ` · <b>${item.review} do decyzji</b>` : ''}</span>${bar(item.matchRate)}</button></li>`,
                  )
                  .join('')
              : '<li class="inline-note">Brak fraz — uruchom pierwszy skan.</li>'
          }</ul>
        </section>
        <section>
          <h4>Jakość źródeł</h4>
          <table class="source-quality"><thead><tr><th>Źródło</th><th>Oferty</th><th title="Oferty z ISBN">ISBN</th><th title="Przypisane do katalogu">Katalog</th><th title="Oferty ze zdjęciem">Foto</th></tr></thead><tbody>${data.sources
            .map(
              (row) =>
                `<tr><th scope="row"><span class="source-dot" data-source="${escapeHtml(row.source)}"></span>${escapeHtml(row.source)}</th><td>${row.offers}</td><td>${rate(row.isbnRate)}${bar(row.isbnRate)}</td><td>${rate(row.matchRate)}${bar(row.matchRate)}</td><td>${rate(row.imageRate)}${bar(row.imageRate)}</td></tr>`,
            )
            .join('')}</tbody></table>
          <h4>Kompletność wydań</h4>
          <dl class="completeness">${[
            ['Rok', data.completeness.year],
            ['Wydawca', data.completeness.publisher],
            ['ISBN', data.completeness.isbn],
            ['Okładka', data.completeness.cover],
          ]
            .map(([label, value]) => `<div><dt>${label}</dt><dd>${rate(value)}${bar(value)}</dd></div>`)
            .join('')}</dl>
          <p class="inline-note">${data.completeness.works} dzieł · ${data.completeness.editions} wydań</p>
          ${f.withImage < f.offers ? '<div class="photo-backfill" id="photoBackfill"></div>' : ''}
        </section>
      </div>`;
    if (panel.querySelector('#photoBackfill')) void backfillTick();
  }
  void refresh();
  return refresh;
}
