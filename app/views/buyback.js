import { json } from '../core/api.js';
import { escapeHtml, moneyFromZloty } from '../core/formatters.js';

// Wholesale buyback floor (skupksiazek.pl): what a book can always be sold for, as the buyer's
// preliminary quote. Shown on editions and checked on demand or by a slow background pass.
const digits = (value) => String(value ?? '').replace(/\D/g, '');
const when = (value) => new Date(value).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });

export function buybackText(quote) {
  if (!quote) return 'nie sprawdzono';
  if (quote.status === 'priced') return moneyFromZloty(quote.price);
  if (quote.status === 'manual') return 'wycena ręczna';
  if (quote.status === 'not_bought') return 'nie skupują';
  return 'błąd sprawdzania';
}

const post = (path, body = {}) =>
  json(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function isbn13Of(identifiers = []) {
  const value = identifiers.find((item) => item.scheme === 'isbn13')?.value;
  return value && digits(value).length === 13 ? digits(value) : null;
}

// Section in the edition card: last quote, its age and a "check now" button.
export function mountEditionBuyback({ row, target, toast }) {
  const isbn = isbn13Of(row.identifiers);
  const section = document.createElement('section');
  section.className = 'detail-section buyback-box';
  const first = target.querySelector('.detail-section');
  if (first) first.after(section);
  else target.append(section);
  if (!isbn) {
    section.innerHTML = '<h4>Skup hurtowy</h4><p class="inline-note">Wycena w skupksiazek.pl wymaga ISBN-13.</p>';
    return section;
  }
  function render(quote, busy = false) {
    const tone = quote?.status === 'priced' ? 'is-priced' : quote?.status === 'error' ? 'is-error' : '';
    const meta = quote
      ? `sprawdzono ${escapeHtml(when(quote.checkedAt))}${quote.stale ? ' · nieaktualne' : ''}${quote.message && quote.status !== 'priced' ? ' · ' + escapeHtml(quote.message) : ''}${quote.refreshError ? ' · odświeżenie nieudane: ' + escapeHtml(quote.refreshError) : ''}`
      : 'Cena, za którą skupksiazek.pl wstępnie odkupi to wydanie.';
    section.innerHTML = `<h4>Skup hurtowy — skupksiazek.pl</h4><div class="buyback-row"><strong class="buyback-price ${tone}">${escapeHtml(buybackText(quote))}</strong><button type="button" class="button secondary compact"${busy ? ' disabled' : ''}>${busy ? 'Sprawdzam…' : quote ? 'Sprawdź ponownie' : 'Sprawdź cenę skupu'}</button></div><p class="inline-note">${meta}</p><p class="inline-note">Cena wstępna — skup weryfikuje stan po otrzymaniu. Zamówienie od 30 zł.</p>`;
    section.querySelector('button').addEventListener('click', async () => {
      render(quote, true);
      try {
        const fresh = await post('/api/buyback/check', { isbn, force: true });
        if (section.isConnected) render(fresh);
      } catch (error) {
        toast?.('Nie sprawdzono ceny skupu: ' + error.message);
        if (section.isConnected) render(quote);
      }
    });
  }
  render(null);
  void json('/api/buyback/quotes?isbn=' + isbn)
    .then((data) => section.isConnected && render(data.quotes?.[isbn] || null))
    .catch(() => {});
  return section;
}

// Work card: a small price chip on each edition line that already has a quote.
export async function annotateEditionLines(row, target) {
  const byEdition = new Map(row.editions.map((edition) => [edition.id, isbn13Of(edition.identifiers)]).filter(([, isbn]) => isbn));
  if (!byEdition.size) return;
  let quotes;
  try {
    quotes = (await json('/api/buyback/quotes?isbn=' + [...byEdition.values()].join(','))).quotes || {};
  } catch {
    return;
  }
  for (const button of target.querySelectorAll('[data-edition-detail]')) {
    const quote = quotes[byEdition.get(button.dataset.editionDetail)];
    if (!quote || button.querySelector('.buyback-chip')) continue;
    const chip = document.createElement('small');
    chip.className = 'buyback-chip' + (quote.status === 'priced' ? ' is-priced' : '');
    chip.textContent = 'skup: ' + buybackText(quote);
    chip.title = 'skupksiazek.pl, sprawdzono ' + when(quote.checkedAt);
    button.append(chip);
  }
}

// Dashboard strip: how much of the catalogue has a buyback quote, and the slow background check.
export function mountBuybackBatch(container) {
  let timer = null;
  const box = document.createElement('div');
  box.className = 'buyback-batch';
  container.append(box);
  function markup(status) {
    const s = status.summary;
    const head = `<span class="inline-note">Skup hurtowy: <b>${s.priced}</b> z ${s.isbns} ISBN z ceną (razem ${escapeHtml(moneyFromZloty(s.pricedValue))})${s.manual ? ` · ${s.manual} wycena ręczna` : ''}${s.notBought ? ` · ${s.notBought} nie skupują` : ''}</span>`;
    if (status.state === 'running')
      return `${head}<span class="inline-note">Sprawdzam skupksiazek.pl: ${status.done}/${status.total} · co ok. 10 s, żeby nie obciążać serwisu</span><span class="mini-bar" data-pct="${Math.round((status.total ? status.done / status.total : 0) * 20) * 5}"><i></i></span><button type="button" class="button secondary compact" data-buyback="cancel">Zatrzymaj</button>`;
    const last = status.finishedAt ? `Ostatnio sprawdzono ${status.done}, z ceną ${status.priced}${status.errors ? `, błędy ${status.errors}` : ''}.${status.lastError ? ' ' + escapeHtml(status.lastError) : ''}` : '';
    return `${head}${last ? `<span class="inline-note">${last}</span>` : ''}${s.pending ? `<button type="button" class="button secondary compact" data-buyback="start">Sprawdź ceny skupu (${s.pending})</button>` : '<span class="inline-note">Wszystkie wyceny są aktualne (do 7 dni).</span>'}`;
  }
  async function tick() {
    clearTimeout(timer);
    if (!box.isConnected) return;
    try {
      const status = await json('/api/buyback/batch');
      box.innerHTML = markup(status);
      if (status.state === 'running') timer = setTimeout(tick, 5000);
    } catch {
      box.textContent = '';
    }
  }
  box.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-buyback]');
    if (!action) return;
    action.disabled = true;
    try {
      await post('/api/buyback/batch' + (action.dataset.buyback === 'cancel' ? '/cancel' : ''));
    } catch {
      // The status line shows the real state.
    }
    void tick();
  });
  void tick();
}
