import { zlotyToGrosze, money } from '../core/formatters.js';
import { markDirty,watchForm } from '../core/ux.js';
// Legacy localStorage is used only for explicit import and fallback. SQLite is the live store.
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
let sqliteNotes = null;
export function allSavedOfferNotes() { return sqliteNotes || {}; }
export async function loadOfferWorkspace(json) {
  const response = await json('/api/offer-workspace');
  sqliteNotes = Object.fromEntries((response.items || []).map(item => [item.offerId,item]));
  return sqliteNotes;
}
export function isWatchedOffer(id) {
  return Boolean(sqliteNotes?.[String(id)]?.watched);
}
export function mountOfferWorkspace(offer, container, onChange = () => {}, options = {}) {
  const id = String(offer.id);
  const notes = options.json ? (sqliteNotes || {}) : readOfferNotes();
  const current = notes[id] || {};
  const section = document.createElement('section');
  section.className = 'detail-section offer-workspace trading-only';
  const title = document.createElement('h4');
  title.textContent = options.json ? 'Decyzja zakupowa' : 'Decyzja zakupowa (ta przeglądarka)';
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
  const targetStatus = document.createElement('small');
  targetStatus.setAttribute('role', 'status');
  section.append(targetStatus);
  const showThreshold = () => {
    const value = target.value.trim() === '' ? null : Number(target.value);
    const asking = offer.currentPrice;
    const threshold = value === null ? null : zlotyToGrosze(value);
    targetStatus.textContent = threshold !== null && Number.isSafeInteger(asking) && offer.currency === 'PLN'
      ? asking <= threshold ? 'Cena osiągnęła próg: oferta w cenie docelowej lub niższej.' : 'Cena jest wyższa od docelowej o ' + money(asking - threshold) + '.'
      : value !== null && offer.currency !== 'PLN' ? 'Próg dotyczy wyłącznie ofert w PLN.' : '';
  };
  target.addEventListener('input', showThreshold);
  showThreshold();
  const savedForm=watchForm('offer-notes',[checkbox,status,target,note]);
  const commit = async () => {
    const value = target.value.trim();
    const price = value === '' ? null : Number(value);
    if (price !== null && (zlotyToGrosze(price) === null || Math.abs(price * 100 - Math.round(price * 100)) > 1e-7)) {
      message.textContent = 'Cena docelowa musi być nieujemna.';
      return;
    }
    const record = {
      watched: checkbox.checked,
      status: status.value,
      targetPrice: price,
      note: note.value.trim().slice(0, 2000),
    };
    if (options.json) {
      save.disabled = true;
      checkbox.disabled = true;
      try {
        const saved = await options.json('/api/offer-workspace/' + encodeURIComponent(id), {
          method:'PUT', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(record)
        });
        if (!sqliteNotes) sqliteNotes = {};
        sqliteNotes[id] = saved;
        await loadOfferWorkspace(options.json);
        savedForm();
        message.textContent = 'Zapisano notatkę i status.';
        onChange();
      } catch(error) { message.textContent = 'Błąd zapisu: ' + error.message; }
      finally { save.disabled = false; checkbox.disabled = false; }
      return;
    }
    const updated = readOfferNotes();
    updated[id] = { ...record, updatedAt:new Date().toISOString() };
    message.textContent = saveOfferNotes(updated)
      ? 'Zapisano lokalnie w tej przeglądarce.'
      : 'Nie udało się zapisać danych przeglądarki.';
    onChange();
  };
  save.addEventListener('click', commit);
  container.append(section);
}
