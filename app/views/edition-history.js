// Read existing observations only. No synthetic points or changes to storage.
export function historyRows(offers) {
  return offers.flatMap(offer => (offer.priceHistory || []).map(point => ({
    offerId: offer.id, title: offer.title, source: offer.source,
    price: point.price, observedAt: point.observedAt,
  }))).sort((a, b) => (Date.parse(b.observedAt) || 0) - (Date.parse(a.observedAt) || 0));
}

export async function readObservationBatch(offers, json) {
  const result = { offers: [], failures: 0 };
  const pending = offers.slice(0, 20);
  for (let index = 0; index < pending.length; index += 4) {
    const batch = await Promise.allSettled(pending.slice(index, index + 4).map(offer => json('/api/offers/' + encodeURIComponent(offer.id))));
    for (const entry of batch) {
      if (entry.status === 'fulfilled') result.offers.push(entry.value);
      else result.failures++;
    }
  }
  return result;
}

export function mountEditionHistory({ row, target, json, money, openOfferDrawer }) {
  const root = document.createElement('section');
  root.className = 'detail-section edition-history';
  const heading = document.createElement('h4');
  heading.textContent = 'Historia obserwacji cen';
  const note = document.createElement('p');
  note.className = 'inline-note';
  note.textContent = 'Zapisane odczyty cen ogłoszeń przypisanych obecnie do tego wydania. To ceny ofertowe, nie transakcje.';
  const status = document.createElement('p');
  status.className = 'history-status';
  status.setAttribute('role', 'status');
  const list = document.createElement('div');
  list.className = 'observation-list';
  const load = document.createElement('button');
  load.type = 'button';
  load.className = 'button secondary';
  load.textContent = 'Wczytaj historię';
  const offers = row.offers || [];
  const loaded = new Map();
  let visible = 30;
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'button secondary';
  more.textContent = 'Pokaż starsze obserwacje';
  more.hidden = true;
  function render() {
    const rows = historyRows([...loaded.values()]);
    status.textContent = `Historia ${loaded.size}/${offers.length} ofert · ${rows.length} zapisanych obserwacji`;
    list.replaceChildren();
    for (const point of rows.slice(0, visible)) {
      const button = document.createElement('button');
      button.className = 'observation-row';
      button.type = 'button';
      const copy = document.createElement('span');
      const time = document.createElement('time');
      const parsed = new Date(point.observedAt);
      time.textContent = Number.isNaN(parsed.getTime()) ? 'Brak daty' : parsed.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
      if (!Number.isNaN(parsed.getTime())) time.dateTime = parsed.toISOString();
      const source = document.createElement('small');
      source.textContent = `${point.source} · ${point.title}`;
      copy.append(time, source);
      const price = document.createElement('strong');
      price.textContent = money(point.price);
      button.append(copy, price);
      button.addEventListener('click', () => openOfferDrawer(point.offerId));
      list.append(button);
    }
    more.hidden = rows.length <= visible;
    load.hidden = loaded.size === offers.length;
    load.textContent = loaded.size ? 'Wczytaj historię kolejnych ofert' : 'Wczytaj historię';
    if (loaded.size === offers.length && !rows.length) status.textContent = 'Brak zapisanych obserwacji cen dla tych ofert.';
  }
  more.addEventListener('click', () => { visible += 30; render(); });
  load.addEventListener('click', async () => {
    load.disabled = true;
    status.textContent = 'Wczytywanie zapisanej historii…';
    const pending = offers.filter(offer => !loaded.has(offer.id)).slice(0, 20);
    const { offers: results, failures } = await readObservationBatch(pending, json);
    if (!root.isConnected) return;
    for (const offer of results) loaded.set(offer.id, offer);
    render();
    if (failures) status.textContent += ` · Nie odczytano ${failures} ofert. Spróbuj ponownie.`;
    load.disabled = false;
  });
  root.append(heading, note, status, list, load, more);
  target.append(root);
  if (!offers.length) render();
  return root;
}
