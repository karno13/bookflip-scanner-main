// Series view of the catalogue: universe ("Świat Dysku", "Warhammer") → cycle ("Herezja Horusa")
// → volume. Read from BN titles, the scan phrase that found the offers, and the operator's manual
// annotation (which always wins). Display and navigation only — never identification evidence.
import { fold } from './title-proposals.mjs';
import { proxiedImage } from './offer-images.mjs';

// Universe names that appear on covers / in BN series statements, with the label shown.
const UNIVERSES = [
  [/\b(?:discworld|swiat dysku)\b/, 'Świat Dysku'],
  [/\bwarcraft\b/, 'Warcraft'],
  [/\bwarhammer\b|\bage of sigmar\b|\bherezja horusa\b|\bczarna biblioteka\b/, 'Warhammer'],
  [/\bdragonlance\b/, 'Dragonlance'],
  [/\bforgotten realms\b|\bdrizzt/, 'Forgotten Realms'],
];
// Publisher lines and genre labels: numbered, but not a story cycle.
const NOT_A_CYCLE =
  /^(?:wielka kolekcja|kolekcja.*|czarna biblioteka|fantastyka|fantasy|sf|seria.*fantasy|biblioteka.*|blizzard legends)$/i;
// Brand words that are not a cycle on their own ("Discworld series t. 14" = the universe itself).
const BRAND_ONLY = /^(?:discworld(?: series)?|swiat dysku|warhammer(?: 40[ .,]?000| fantasy| chronicles)?|world of warcraft|warcraft|dragonlance(?: saga)?|forgotten realms)$/;

export function universeOf(text) {
  const folded = fold(text);
  return UNIVERSES.find(([pattern]) => pattern.test(folded))?.[1] ?? null;
}

/** Cycle and volume from a BN title: "…, Legenda Drizzta ; ks. 7 Forgotten Realms" → {Legenda Drizzta, 7}. */
export function cycleFromTitle(title) {
  const text = String(title ?? '').replace(/\s+/g, ' ');
  const statement = text.includes(' / ') ? text.slice(text.indexOf(' / ') + 3) : '';
  if (!statement) return null;
  const pattern = /([^,;/()]*?)\s*(?:;\s*(?:t\.|tom|ks\.|cz\.)?|\b(?:t\.|tom|ks\.|cz\.))\s*(\d{1,3})\b/gi;
  let fallback = null;
  for (const match of statement.matchAll(pattern)) {
    // "Dragonlance Saga. Kroniki Elfich Narodów" → the most specific (last) part names the cycle.
    const parts = match[1].split(/\.\s+/).map((part) => part.replace(/[\s.:,-]+$/g, '').trim()).filter(Boolean);
    const name = stripOriginalTitle(parts.at(-1) || '');
    const volume = Number(match[2]);
    if (!volume) continue;
    if (!name || NOT_A_CYCLE.test(name)) continue;
    if (BRAND_ONLY.test(fold(name))) {
      fallback ??= { cycle: null, volume };
      continue;
    }
    if (name.length < 3 || name.length > 60) continue;
    return { cycle: name, volume };
  }
  return fallback;
}

/**
 * Without a comma BN runs the original title into the series: "Halfling's gem Legenda Drizzta",
 * "Horus heresy Herezja Horusa". The cycle starts at the last capitalised word that follows a
 * lower-case word of 3+ letters ("i", "of" do not split "Przygody Gotreka i Felixa").
 */
export function stripOriginalTitle(name) {
  const words = String(name).split(' ');
  for (let index = words.length - 1; index > 0; index--)
    if (/^\p{Lu}/u.test(words[index]) && /^\p{Ll}[\p{L}'’-]{2,}$/u.test(words[index - 1]))
      return words.slice(index).join(' ');
  return name;
}

function cycleKey(name) {
  return fold(name).replace(/\b(?:cykl|saga|seria|series|trylogia|trilogy)\b/g, '').replace(/\s+/g, ' ').trim();
}

export function catalogSeries(repository) {
  const db = repository.database;
  const works = db
    .prepare(
      `SELECT w.id, w.title,
         (SELECT count(*) FROM editions e WHERE e.work_id=w.id) AS editions,
         (SELECT count(*) FROM offer_matches m JOIN editions e ON e.id=m.edition_id WHERE e.work_id=w.id AND m.status='active') AS offers
       FROM works w WHERE NOT EXISTS (SELECT 1 FROM catalog_work_merges x WHERE x.source_id=w.id)`,
    )
    .all();
  const editionTitles = new Map();
  for (const row of db.prepare('SELECT work_id, title, publication_year FROM editions').all()) {
    if (!editionTitles.has(row.work_id)) editionTitles.set(row.work_id, []);
    editionTitles.get(row.work_id).push(row);
  }
  // The phrase that found most of a work's offers is the operator's own name for its series.
  const phrases = new Map();
  for (const row of db
    .prepare(
      `SELECT e.work_id, json_extract(o.matched_queries_json,'$[0]') AS phrase, count(*) AS n
       FROM offer_matches m JOIN editions e ON e.id=m.edition_id JOIN offers o ON o.id=m.offer_id
       WHERE m.status='active' AND phrase IS NOT NULL GROUP BY e.work_id, phrase ORDER BY n DESC`,
    )
    .all())
    if (!phrases.has(row.work_id)) phrases.set(row.work_id, String(row.phrase).trim());
  const covers = new Map();
  for (const row of db
    .prepare(
      `SELECT e.work_id, o.image_url FROM offer_matches m JOIN editions e ON e.id=m.edition_id JOIN offers o ON o.id=m.offer_id
       WHERE m.status='active' AND o.image_url IS NOT NULL
       ORDER BY CASE o.source WHEN 'Empik' THEN 0 WHEN 'Tezeusz.pl' THEN 1 WHEN 'Dedalus.pl' THEN 2 ELSE 3 END, o.last_seen_at DESC`,
    )
    .all())
    if (!covers.has(row.work_id)) covers.set(row.work_id, proxiedImage(row.image_url));
  const manual = new Map(
    db.prepare('SELECT work_id, series, volume FROM work_series_annotations').all().map((row) => [row.work_id, row]),
  );

  const universes = new Map();
  for (const work of works) {
    const titles = [work.title, ...(editionTitles.get(work.id) || []).map((edition) => edition.title)];
    const phrase = phrases.get(work.id) || '';
    const universe = universeOf(titles.join(' ')) || universeOf(phrase) || (phrase ? capitalize(phrase) : 'Poza seriami');
    const annotation = manual.get(work.id);
    const parsed = titles.map(cycleFromTitle).find((item) => item?.cycle) || titles.map(cycleFromTitle).find(Boolean) || null;
    const cycle = annotation ? annotation.series : parsed?.cycle || null;
    const volume = annotation ? annotation.volume : parsed?.volume ?? null;
    const years = (editionTitles.get(work.id) || []).map((edition) => edition.publication_year).filter(Boolean);
    if (!universes.has(universe)) universes.set(universe, []);
    universes.get(universe).push({
      id: work.id,
      title: work.title,
      cover: covers.get(work.id) || null,
      cycle,
      volume,
      manual: Boolean(annotation),
      editions: Number(work.editions || 0),
      offers: Number(work.offers || 0),
      firstYear: years.length ? Math.min(...years) : null,
    });
  }

  return [...universes]
    .map(([name, list]) => {
      const cycles = new Map();
      for (const work of list) {
        const key = work.cycle && cycleKey(work.cycle) !== cycleKey(name) ? cycleKey(work.cycle) : '';
        if (!cycles.has(key)) cycles.set(key, { name: key ? work.cycle : null, works: [] });
        cycles.get(key).works.push(work);
      }
      const cycleList = [...cycles.values()]
        .map((cycle) => {
          cycle.works.sort(
            (a, b) =>
              (a.volume ?? 1e6) - (b.volume ?? 1e6) ||
              (a.firstYear ?? 1e4) - (b.firstYear ?? 1e4) ||
              String(a.title).localeCompare(String(b.title), 'pl'),
          );
          const volumes = [...new Set(cycle.works.map((work) => work.volume).filter(Number.isInteger))].sort((a, b) => a - b);
          const missing = [];
          for (let number = 1; volumes.length && number < volumes.at(-1) && missing.length < 60; number++)
            if (!volumes.includes(number)) missing.push(number);
          return { ...cycle, volumes, missing };
        })
        // Named cycles first (by size), the loose works of the universe last.
        .sort((a, b) => (a.name === null) - (b.name === null) || b.works.length - a.works.length || String(a.name).localeCompare(String(b.name), 'pl'));
      return { name, works: list.length, offers: list.reduce((sum, work) => sum + work.offers, 0), cycles: cycleList };
    })
    .sort((a, b) => (a.name === 'Poza seriami') - (b.name === 'Poza seriami') || b.works - a.works || a.name.localeCompare(b.name, 'pl'));
}

function capitalize(text) {
  return text.charAt(0).toLocaleUpperCase('pl') + text.slice(1);
}
