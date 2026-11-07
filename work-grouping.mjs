// Groups editions of the same book under one work. BN records carry no work identifier, so without
// this every ISBN (every reprint, every publisher) became its own work. The key is deliberately
// strict - same main title AND same first author - because a wrong merge is worse than a missed one.
import { fold } from './title-proposals.mjs';

const UNIVERSE_PREFIX =
  /^\s*(?:world of warcraft|warcraft|warhammer(?: 40[ ,.]?000| 40k)?|dragonlance|forgotten realms|świat dysku)\s*[:.]\s+/i;

/** "Para w ruch / Raising steam, Discworld series ; t. 40" -> "Para w ruch" */
export function mainTitle(title) {
  const text = String(title ?? '');
  // "World of Warcraft: Illidan" and "Illidan / World of Warcraft" are the same work: a universe
  // prefix followed by ":" or "." is cover branding, not the title (the author must still match).
  const unbranded = text.replace(UNIVERSE_PREFIX, '');
  return (fold(unbranded.split(' / ')[0]).length >= 3 ? unbranded : text)
    .split(' / ')[0]
    .split(' : ')[0]
    .split(' ; ')[0]
    .trim();
}

/** Surname of the first author: BN "Pratchett, Terry (1948-2015) ..." or "Terry Pratchett". */
export function firstSurname(authors) {
  const first = [].concat(authors ?? []).map(String).find((value) => value.trim());
  if (!first) return '';
  const text = first.replace(/\([^)]*\)/g, ' ').trim();
  const surname = text.includes(',') ? text.split(',')[0] : text.split(/\s+/).at(-1);
  return fold(surname);
}

export function workKey(title, authors) {
  const name = fold(mainTitle(title));
  const surname = firstSurname(authors);
  if (name.length < 3 || surname.length < 2) return null;
  return `${name}|${surname}`;
}

function parseAuthors(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function liveWorks(repository) {
  return repository.database
    .prepare(
      `SELECT w.id, w.title, w.authors_json, w.created_at,
         (SELECT count(*) FROM editions e WHERE e.work_id = w.id) AS editions,
         (SELECT count(*) FROM offer_matches m JOIN editions e ON e.id = m.edition_id
            WHERE e.work_id = w.id AND m.status = 'active') AS offers
       FROM works w
       WHERE NOT EXISTS (SELECT 1 FROM catalog_work_merges x WHERE x.source_id = w.id)`,
    )
    .all();
}

/** An existing work that is the same book as (title, authors), or null. */
export function findWorkByKey(repository, title, authors) {
  const key = workKey(title, authors);
  if (!key) return null;
  const matches = liveWorks(repository).filter((work) => workKey(work.title, parseAuthors(work.authors_json)) === key);
  // Ambiguous (several works already share the key): leave the decision to the operator.
  return matches.length === 1 ? matches[0] : null;
}

/** Groups of works that look like the same book, largest first, with a suggested target. */
export function findDuplicateWorkGroups(repository) {
  const groups = new Map();
  for (const work of liveWorks(repository)) {
    const authors = parseAuthors(work.authors_json);
    const key = workKey(work.title, authors);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      id: work.id,
      title: work.title,
      authors,
      editions: Number(work.editions),
      offers: Number(work.offers),
      createdAt: work.created_at,
    });
  }
  return [...groups.entries()]
    .filter(([, works]) => works.length > 1)
    .map(([key, works]) => {
      // Keep the work that already carries the most offers, then editions, then the oldest.
      const ranked = [...works].sort(
        (a, b) => b.offers - a.offers || b.editions - a.editions || String(a.createdAt).localeCompare(String(b.createdAt)),
      );
      return { key, targetId: ranked[0].id, works: ranked };
    })
    .sort((a, b) => b.works.length - a.works.length || a.key.localeCompare(b.key));
}
