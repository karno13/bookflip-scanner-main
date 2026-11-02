// Browser-local shortlist; intentionally separate from the SQLite catalogue.
// No network requests and no changes to offer identification state.
const KEY = 'bookflip-offer-workspace-v1';
const statuses = [
  ['watching', 'Obserwowana'],
  ['check', 'Do sprawdzenia'],
  ['negotiating', 'Negocjacja'],
  ['bought', 'Kupiona'],
  ['rejected', 'Odrzucona'],
];
export function readOfferNotes(storage = localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
export function saveOfferNotes(notes, storage = localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(notes));
    return true;
  } catch { return false; }
}
export function isWatchedOffer(id) {
  return Boolean(readOfferNotes()[String(id)]?.watched);
}
export function mountOfferWorkspace(offer, container, onChange = () => {}) {
  const id = String(offer.id);
  const notes = readOfferNotes();
  const current = notes[id] || {};
  const section = document.createElement('section');
  section.className = 'detail-section offer-workspace';
  const title = document.createElement('h4');
  title.textContent = 'Moja lista zakupowa (tylko ta przeglądarka)';
  section.append(title);
  const watched = document.createElement('label');
  watched.className = 'offer-workspace-check';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = Boolean(current.watched);
  watched.append(checkbox, document.createTextNode(' Obserwuj ofertę'));
  section.append(watched);
  const status = document.createElement('select');
  status.setAttribute('aria-label', 'Status zakupowy');
  for (const [value, label] of statuses) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    status.append(option);
  }
  status.value = current.status || 'watching';
  const target = document.createElement('input');
  target.type = 'number';
  target.min = '0';
  target.step = '0.01';
  target.placeholder = 'Cena docelowa (zł)';
  target.setAttribute('aria-label', 'Cena docelowa w złotych');
  target.value = current.targetPrice ?? '';
  const note = document.createElement('textarea');
  note.rows = 3;
  note.maxLength = 2000;
  note.placeholder = 'Notatka, np. stan książki, brakujące tomy';
  note.setAttribute('aria-label', 'Notatka o ofercie');
  note.value = current.note || '';
  const save = document.createElement('button');
  save.className = 'button secondary';
  save.type = 'button';
  save.textContent = 'Zapisz notatkę i status';
  const message = document.createElement('small');
  message.setAttribute('role', 'status');
  section.append(status, target, note, save, message);
  const commit = () => {
    const value = target.value.trim();
    const price = value === '' ? null : Number(value);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      message.textContent = 'Cena docelowa musi być nieujemna.';
      return;
    }
    const updated = readOfferNotes();
    const watchedValue = checkbox.checked;
    if (watchedValue || note.value.trim() || price !== null || status.value !== 'watching') {
      updated[id] = {
        watched: watchedValue,
        status: status.value,
        targetPrice: price,
        note: note.value.trim().slice(0, 2000),
        updatedAt: new Date().toISOString(),
      };
    } else delete updated[id];
    message.textContent = saveOfferNotes(updated)
      ? 'Zapisano lokalnie w tej przeglądarce.'
      : 'Nie udało się zapisać danych przeglądarki.';
    onChange();
  };
  checkbox.addEventListener('change', commit);
  save.addEventListener('click', commit);
  container.append(section);
}
