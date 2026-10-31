// Retrieval aliases never confer edition identity or bibliographic verification.
export const normalizeSearch = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const families = [
  ['Warhammer', 'Warhammer 40,000', 'WH40K', 'Warhammer 40K'],
  ['Herezja Horusa', 'Horus Heresy'],
  ['Warcraft', 'World of Warcraft'],
  ['Forgotten Realms', 'Zapomniane Krainy'],
];
export function searchAliases(title) {
  const key = normalizeSearch(title);
  return (
    families
      .find((g) => g.some((t) => normalizeSearch(t) === key))
      ?.filter((t) => normalizeSearch(t) !== key) || []
  );
}
export function queryText(task) {
  const category = String(task.category || '').trim();
  const fallback = normalizeSearch(category).startsWith('warhammer') ? 'Warhammer' : category;
  return String(
    task.searchQuery || (task.mode === 'watchlist' ? task.title : fallback || task.title || ''),
  ).trim();
}
export function matchesSearch(task, title) {
  const text = normalizeSearch(title),
    terms = [
      task.title,
      task.searchQuery,
      ...(task.aliases || []),
      ...searchAliases(task.title),
    ].filter(Boolean);
  const match = terms.some((term) => {
    const tokens = normalizeSearch(term).split(' ').filter(Boolean);
    return tokens.length && tokens.every((t) => (' ' + text + ' ').includes(' ' + t + ' '));
  });
  return match;
}
// One matching policy for HTML marketplaces, Atom and authorized JSON feeds.
export function matchesTopic(task, title) {
  if (task.mode === 'watchlist') return matchesSearch(task, title);
  const category = normalizeSearch(task.category);
  const categoryTerms = category.includes('warcraft')
    ? ['Warcraft', 'World of Warcraft']
    : category.includes('warhammer') || category.includes('horus') || category.includes('herezja')
      ? [
          'Warhammer',
          'Warhammer 40,000',
          'WH40K',
          'Warhammer 40K',
          'Horus',
          'Horus Heresy',
          'Herezja Horusa',
        ]
      : [];
  const terms = [task.searchQuery, task.title, ...(task.aliases || []), ...categoryTerms];
  if (!terms.some(Boolean)) terms.push(task.category || '');
  return matchesSearch({ title: '', searchQuery: '', aliases: terms }, title);
}
// Conservative relevance scoring: verified bibliographic evidence boosts a
// candidate, but explicit physical non-book formats always block it. Unknown
// titles remain eligible for discovery instead of being silently discarded.
export function bookProductSignals(title, { isbn = null } = {}) {
  const n = normalizeSearch(title);
  const book =
    /\b(ksiazka|ksiazki|ksiazek|book|books|powiesc|novel|tom|tomy|omnibus|codex|kodeks|podrecznik)\b/.test(
      n,
    );
  const format =
    /\b(ebook|e book|epub|mobi|audiobook|audio book|stl|gra pc|gra ps5|gra ps4|gra komputerowa)\b/.test(
      n,
    );
  const explicitNonBook =
    /\b(plecak|plecaki|backpack|rucksack|gra karciana|gry karciane|card game|karcianka|karcianki|talia kart|deck kart|gra planszowa|board game|karty kolekcjonerskie|trading cards|figurek|figurka|figurki|statuetka|miniatures?|miniatura|unpainted|sprue|wypraski|bits|booster|foil|naklejki|cosplay|pistol|dice|kosci|kostki|jetbike|farba|paint|gpu|geforce|rtx|funko|casio|zegarek|xbox|ps2|ps3|ps4|ps5)\b/.test(
      n,
    ) ||
    /\b(magic the gathering|czas[u]? gry|konto do gry|model do sklejania|zestaw figurek|gra na pc|gra na xbox)\b/.test(
      n,
    );
  const accessory = /\b(zakladka|bookmark)\b/.test(n);
  const score =
    (book ? 3 : 0) +
    (isbn ? 5 : 0) -
    (format ? 10 : 0) -
    (explicitNonBook ? 8 : 0) -
    (accessory && !book ? 4 : 0);
  return {
    score,
    book,
    explicitNonBook,
    format,
    excluded: format || explicitNonBook || score <= -3,
  };
}
export function excludesProduct(title, options) {
  return bookProductSignals(title, options).excluded;
}
export function expandSearchTopics(topics) {
  const seen = new Set(),
    out = [];
  for (const t of topics) {
    const variants = [
      t.title,
      ...(t.aliases || []),
      ...(t.includeAliases === false ? [] : searchAliases(t.title)),
    ];
    if (t.searchMode === 'bundle') variants.push(t.title + ' zestaw', t.title + ' pakiet');
    if (t.searchMode === 'edition' && t.isbn) variants.push(t.isbn);
    for (const searchQuery of variants) {
      const key = normalizeSearch(searchQuery);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...t, searchQuery });
    }
  }
  return out;
}
// Every query remains in the round; productivity changes order, never deletes work.
export function prioritizeSearchPairs(pairs, history, now = Date.now()) {
  const rank = (p) => {
    const rows = history.filter(
      (t) => t.source === p.source.name && (t.searchQuery || t.query) === p.topic.searchQuery,
    );
    const last = rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    if (!last) return 1000;
    const age = Math.max(0, (now - Date.parse(last.updatedAt)) / 3600000);
    return (
      Math.min(age, 168) * 10 +
      ((last.added || 0) /
        Math.max(1, (last.added || 0) + (last.updated || 0) + (last.unchanged || 0))) *
        20 +
      (p.topic.priority || 0)
    );
  };
  return pairs
    .map((p, i) => ({ p, i, score: rank(p) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.p);
}
