// Readable bibliographic labels from raw BN / Open Library / marketplace strings.
// Display only: nothing here is used as identification evidence.

const trimPunctuation = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:./-]+|[\s,;:/-]+$/g, '')
    .trim();

/** "Pomniejsze bóstwa / Small gods, Wielka kolekcja ; 28 Discworld series" → parts. */
export function splitBnTitle(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const [main, ...rest] = text.split(' / ');
  const tail = rest.join(' / ');
  let series = null;
  let volume = null;
  const seriesMatch = tail.match(/,\s*([^,;]+?)\s*;\s*(\d{1,3})\b/) || text.match(/\(([^();]+?)\s*;\s*(\d{1,3})\)/);
  if (seriesMatch) {
    series = trimPunctuation(seriesMatch[1]);
    volume = Number(seriesMatch[2]);
  }
  const englishSeries = tail.match(/,?\s*([A-Z][\w' ]+?) series\b/);
  return {
    title: trimPunctuation(main),
    original: trimPunctuation(tail.split(',')[0]) || null,
    series,
    volume,
    cycle: englishSeries ? trimPunctuation(englishSeries[1]) : null,
  };
}

/** "Pratchett, Terry (1948-2015) Cholewa, Piotr W. (1955- ) Prószyński Media" → ["Terry Pratchett", "Piotr W. Cholewa"]. */
export function parseBnPeople(authorText, authors = []) {
  const people = [];
  const seen = new Set();
  const add = (name) => {
    const clean = trimPunctuation(name);
    const key = clean.toLocaleLowerCase('pl');
    if (clean && !seen.has(key)) {
      seen.add(key);
      people.push(clean);
    }
  };
  const text = String(authorText ?? '');
  const pattern = /([\p{Lu}][\p{L}'-]+),\s+([\p{Lu}][\p{L}.' -]*?)\s*\(\s*\d{3,4}\s*-\s*(?:\d{3,4})?\s*\)/gu;
  for (const match of text.matchAll(pattern)) add(`${match[2]} ${match[1]}`);
  // Without life dates: "Counter, Ben Kowalczyk, Krzysztof Copernicus Corporation".
  if (!people.length && /,/.test(text))
    for (const match of text.matchAll(/([\p{Lu}][\p{L}'-]+),\s+([\p{Lu}][\p{L}'-]*(?:\s+[\p{Lu}]\.)?)/gu))
      add(`${match[2]} ${match[1]}`);
  if (!people.length) for (const name of authors || []) add(String(name).replace(/^([^,]+),\s*(.+)$/, '$2 $1'));
  if (!people.length && text && !/\(\d{4}/.test(text)) add(text.slice(0, 80));
  return people;
}

/** Collapses repeated publisher names and BN cataloguing fragments. */
export function cleanPublisher(raw) {
  let text = trimPunctuation(String(raw ?? '').replace(/\s*:\s*partner\b.*$/i, ''));
  if (!text) return '';
  const words = text.split(' ');
  // Remove an immediately repeated phrase of 1–4 words ("Prószyński Media Prószyński Media").
  for (let size = 4; size >= 1; size--)
    for (let i = 0; i + size * 2 <= words.length; i++) {
      const a = words.slice(i, i + size).join(' ').toLocaleLowerCase('pl');
      const b = words.slice(i + size, i + size * 2).join(' ').toLocaleLowerCase('pl');
      if (a === b) {
        words.splice(i + size, size);
        i--;
      }
    }
  text = words.join(' ');
  return text.length > 70 ? text.slice(0, 67).trimEnd() + '…' : text;
}

/** Normalized description of a proposal / catalog candidate. */
export function describeCandidate(item = {}) {
  const parts = splitBnTitle(item.title);
  const people = parseBnPeople(item.authorText, item.authors);
  return {
    isbn: item.isbn || '',
    title: parts.title || String(item.title || 'Tytuł nieznany'),
    original: parts.original,
    series: parts.series,
    volume: parts.volume,
    cycle: parts.cycle,
    author: people[0] || '',
    contributors: people.slice(1),
    publisher: cleanPublisher(item.publisher),
    year: item.publicationYear ? String(item.publicationYear) : '',
    language: item.language || '',
    source: item.source === 'bn' ? 'Biblioteka Narodowa' : item.source === 'open_library' ? 'Open Library' : item.source || '',
    score: Number(item.score || 0),
  };
}

/** Field names whose values differ between candidates — the facts worth looking at. */
export function differingFields(described, fields = ['year', 'publisher', 'series', 'volume']) {
  return new Set(
    fields.filter((field) => new Set(described.map((item) => String(item[field] ?? ''))).size > 1),
  );
}

/** Cleaner listing title for lists: strips marketing noise but keeps the substance. */
export function tidyOfferTitle(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\b(?:UNIKAT|OKAZJA|HIT|NOWA|NOWY|STAN BDB|BDB|IDEALNY STAN|WYSYŁKA 24H|TANIO)\b!*/gi, '')
    .replace(/[!]{2,}/g, '!')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    .trim() || String(raw ?? '');
}

/** Short display of a catalog work title (BN often stores "Title / Original : subtitle, Series"). */
export function tidyWorkTitle(raw) {
  const parts = splitBnTitle(raw);
  return parts.title || String(raw ?? '');
}

/** Image URL for an ISBN cover via the local cached proxy (Open Library). */
export function isbnCover(isbn, size = 'M') {
  const clean = String(isbn ?? '').replace(/[^0-9X]/gi, '');
  if (!/^(?:\d{9}[\dX]|\d{13})$/.test(clean)) return null;
  return '/api/image?u=' + encodeURIComponent(`https://covers.openlibrary.org/b/isbn/${clean}-${size}.jpg?default=false`);
}

/** Deterministic hue for placeholder covers so one series keeps one color. */
export function hueFor(text) {
  let hash = 0;
  for (const char of String(text ?? '')) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % 360;
}

/**
 * Markup of a cover thumbnail. `src` may be null: then a generated placeholder with the initials is
 * shown. Broken images fall back to the placeholder via installCoverFallback().
 */
export function coverMarkup(src, label, { size = 'md', escapeHtml } = {}) {
  const text = String(label ?? '').trim();
  const initials = text
    .split(/[\s.:,-]+/)
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0].toLocaleUpperCase('pl'))
    .join('');
  const safe = escapeHtml || ((value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
  // CSP forbids inline style attributes; the hue is one of 12 classes defined in app.css.
  const hue = Math.floor(hueFor(text.split(/[.:]/)[0]) / 30);
  return `<span class="cover cover-${size}${src ? ' has-image' : ''}" data-hue="${hue}" aria-hidden="true"><span class="cover-fallback">${safe(initials || '•')}</span>${src ? `<img src="${safe(src)}" alt="" loading="lazy" decoding="async">` : ''}</span>`;
}

/** One delegated listener: a failed cover image reveals the placeholder underneath. */
export function installCoverFallback(root = document) {
  root.addEventListener(
    'error',
    (event) => {
      const image = event.target;
      if (image?.tagName === 'IMG' && image.parentElement?.classList.contains('cover')) {
        image.parentElement.classList.remove('has-image');
        image.remove();
      }
    },
    true,
  );
}
