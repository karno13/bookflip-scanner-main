// Optional series and volume annotations belong to this browser, not SQLite.
const KEY = 'bookflip-work-series-v1';
export function readSeries(storage = globalThis.localStorage) {
  try {
    const data = JSON.parse(storage.getItem(KEY) || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}
export function writeSeries(data, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(data)); return true; }
  catch { return false; }
}
export function seriesSummary(works, annotations) {
  const groups = new Map();
  for (const work of works) {
    const entry = annotations[String(work.id)];
    if (!entry?.series || !Number.isInteger(entry.volume) || entry.volume < 1) continue;
    const name = entry.series.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase('pl');
    if (!groups.has(key)) groups.set(key, { name, volumes: new Set(), books: 0 });
    const group = groups.get(key);
    group.volumes.add(entry.volume);
    group.books++;
  }
  return [...groups.values()].map(({name,volumes,books}) => {
    const ordered = [...volumes].sort((a,b)=>a-b);
    const missing = [];
    for (let number = 1; number < ordered[ordered.length-1] && missing.length < 100; number++)
      if (!volumes.has(number)) missing.push(number);
    return { name, books, volumes: ordered, missing };
  }).sort((a,b)=>a.name.localeCompare(b.name,'pl'));
}
export function mountSeriesEditor(work, target, onSave = () => {}) {
  const data = readSeries();
  const current = data[String(work.id)] || {};
  const block = document.createElement('section');
  block.className = 'detail-section series-editor';
  const heading = document.createElement('h4');
  heading.textContent = 'Seria i tom (notatka lokalna)';
  const series = document.createElement('input');
  series.placeholder = 'Nazwa serii, np. Horus Heresy';
  series.maxLength = 120;
  series.setAttribute('aria-label', 'Nazwa serii');
  series.value = current.series || '';
  const volume = document.createElement('input');
  volume.type = 'number';
  volume.min = '1';
  volume.max = '10000';
  volume.step = '1';
  volume.placeholder = 'Numer tomu';
  volume.setAttribute('aria-label', 'Numer tomu');
  volume.value = current.volume ?? '';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'button secondary';
  save.textContent = 'Zapisz serię i tom';
  const feedback = document.createElement('small');
  feedback.setAttribute('role','status');
  save.addEventListener('click', () => {
    const name = series.value.trim();
    const value = volume.value.trim();
    const number = Number(value);
    if ((name && (!value || !Number.isInteger(number) || number < 1 || number > 10000)) || (!name && value)) {
      feedback.textContent = 'Podaj nazwę serii i poprawny numer tomu (1–10000).';
      return;
    }
    const updated = readSeries();
    if (!name) delete updated[String(work.id)];
    else updated[String(work.id)] = { series: name, volume: number };
    const success = writeSeries(updated);
    feedback.textContent = success ? 'Zapisano tylko w tej przeglądarce.' : 'Nie udało się zapisać.';
    if (success) onSave();
  });
  block.append(heading,series,volume,save,feedback);
  target.append(block);
}
