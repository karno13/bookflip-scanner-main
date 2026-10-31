import { readSourceHtml } from './marketplaces.mjs';
import { rscText, objectAt } from './reference-parsers.mjs';
import { extractOfferISBN } from './isbn.mjs';
const unescapeHTML = (value) =>
  String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
function canonicalItemMatches(html, url, id) {
  const canonical = [...html.matchAll(/<link\b([^>]*rel=["']canonical["'][^>]*)>/gi)]
    .map((m) => m[1])
    .map((attrs) => attrs.match(/\bhref=["']([^"']+)["']/i)?.[1])
    .find(Boolean);
  if (!canonical) return false;
  try {
    const u = new URL(unescapeHTML(canonical), url);
    return (
      ['www.vinted.pl', 'vinted.pl'].includes(u.hostname) &&
      u.pathname.match(/^\/items\/(\d+)(?:-|\/|$)/)?.[1] === id
    );
  } catch {
    return false;
  }
}
function htmlAttributeISBN(html) {
  const opening = /<div\b(?=[^>]*\bdata-testid=["']item-attributes-isbn_nav["'])[^>]*>/i.exec(html);
  if (!opening) return null;
  const start = opening.index + opening[0].length,
    limit = Math.min(html.length, start + 5000),
    tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 1,
    close = null,
    tag;
  while ((tag = tags.exec(html)) && tag.index < limit) {
    if (/^<\//.test(tag[0])) depth--;
    else depth++;
    if (depth === 0) {
      close = tag.index;
      break;
    }
  }
  if (close == null) return null;
  const row = html.slice(start, close),
    match = row.match(
      /<a\b(?=[^>]*\bdata-testid=["']item-attributes-isbn_nav-link["'])[^>]*>([\s\S]*?)<\/a>/i,
    );
  if (!match) return null;
  const value = unescapeHTML(
    match[1]
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  return value ? { parameters: [{ name: 'ISBN', value }] } : null;
}
function languageFromCandidates(candidates) {
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 12) return null;
    if (Array.isArray(node)) {
      for (const entry of node) {
        const found = visit(entry, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (node.code === 'language_book') {
      const value = node.data?.value ?? node.value;
      if (value != null && String(value).trim()) return String(value).trim();
    }
    const label = String(node.name || node.key || node.title || node.data?.title || '');
    if (/^(?:język|language)$/i.test(label)) {
      const value =
        node.data?.value ??
        node.value?.title ??
        node.value?.name ??
        node.value ??
        node.values?.[0]?.title ??
        node.values?.[0]?.name ??
        node.values?.[0];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    for (const key of ['language', 'languageCode', 'language_code'])
      if (node[key] != null && typeof node[key] !== 'object') return String(node[key]).trim();
    for (const value of Object.values(node)) {
      const found = visit(value, depth + 1);
      if (found) return found;
    }
    return null;
  };
  for (const candidate of candidates) {
    const found = visit(candidate);
    if (found) return found;
  }
  return null;
}
// Read only the requested item, never recommendation cards or the full page.
// Never read ISBN from recommendations: require exact item ID or an exact item URL.
export function parseVintedDetail(html, url) {
  const id = new URL(url).pathname.match(/^\/items\/(\d+)(?:-|\/|$)/)?.[1];
  if (!id) throw Error('INVALID_VINTED_ITEM');
  const data = rscText(html),
    candidates = [];
  let identityMatched = false;
  const collect = (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const itemId = node.id ?? node.itemId ?? node.item_id;
    if (String(itemId) !== id) return;
    identityMatched = true;
    // Preserve the entire *identified* item, including nested attributes and
    // ISBN-specific metadata; do not scan the remainder of the page.
    candidates.push(node);
  };
  for (const m of data.matchAll(
    /"(?:item|itemDetails|itemDto|itemDTO|itemData|product|productItem|item_info)"\s*:\s*\{/g,
  )) {
    collect(objectAt(data, m.index + m[0].length - 1));
  }
  // Vinted renders ISBN in selected-item HTML even when RSC omits it.
  if (canonicalItemMatches(html, url, id)) {
    identityMatched = true;
    const evidence = htmlAttributeISBN(html);
    if (evidence) candidates.push(evidence);
  }
  for (const m of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let root;
    try {
      root = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const graph = Array.isArray(root) ? root : [root];
    for (const entry of graph) {
      for (const p of [entry, ...(Array.isArray(entry?.['@graph']) ? entry['@graph'] : [])]) {
        if (!p || typeof p !== 'object') continue;
        const types = Array.isArray(p['@type']) ? p['@type'] : [p['@type']];
        if (!types.some((t) => ['Product', 'Book'].includes(t))) continue;
        const links = [p.url, p.offers?.url].filter((v) => typeof v === 'string');
        const exact = links.some((link) => {
          try {
            const u = new URL(link, url);
            return (
              ['www.vinted.pl', 'vinted.pl'].includes(u.hostname) &&
              u.pathname.match(/^\/items\/(\d+)(?:-|\/|$)/)?.[1] === id
            );
          } catch {
            return false;
          }
        });
        if (exact) {
          identityMatched = true;
          candidates.push(p);
        }
      }
    }
  }
  // In the current Vinted page the selected book's language is rendered as
  // a sibling sidebar section, not inside the identified item object.
  // Read it only after this page has been tied to the requested item ID.
  if (identityMatched)
    for (const match of data.matchAll(/\{\s*"code"\s*:\s*"language_book"/g)) {
      const section = objectAt(data, match.index);
      if (section) candidates.push(section);
    }
  const evidence = extractOfferISBN({ parameters: candidates });
  const language = languageFromCandidates(candidates);
  return {
    isbn: evidence.isbn,
    isbnDetection: evidence,
    recognized: identityMatched,
    isbnStatus: !identityMatched
      ? 'schema_unrecognized'
      : evidence.status === 'missing'
        ? 'missing_in_response'
        : evidence.status === 'valid'
          ? 'found'
          : evidence.status,
    language,
    languageStatus: !identityMatched
      ? 'schema_unrecognized'
      : language
        ? 'found'
        : 'missing_in_response',
  };
}
export async function readVintedISBN(url, options = {}) {
  const u = new URL(url);
  if (
    u.protocol !== 'https:' ||
    !['www.vinted.pl', 'vinted.pl'].includes(u.hostname) ||
    !/^\/items\/\d+/.test(u.pathname) ||
    u.port ||
    u.username ||
    u.password
  )
    throw Error('INVALID_VINTED_ITEM');
  const html = await readSourceHtml(url, { ...options, source: 'Vinted' });
  return parseVintedDetail(html, url);
}
export async function readVintedLanguage(url, options = {}) {
  const u = new URL(url);
  if (
    u.protocol !== 'https:' ||
    !['www.vinted.pl', 'vinted.pl'].includes(u.hostname) ||
    !/^\/items\/\d+/.test(u.pathname) ||
    u.port ||
    u.username ||
    u.password
  )
    throw Error('INVALID_VINTED_ITEM');
  const html = await readSourceHtml(url, { ...options, source: 'Vinted' });
  return parseVintedDetail(html, url);
}

// Small batches bound execution time. A blocked detail read never becomes a successful empty read.
export async function enrichVintedBatch(offers, options = {}) {
  const read = options.reader || readVintedISBN,
    out = [];
  for (const offer of offers) {
    const known = extractOfferISBN(offer);
    if (known.status === 'valid') {
      out.push(offer);
      continue;
    }
    let detail;
    try {
      detail = await read(offer.url, options);
    } catch (e) {
      if (e.blocked || [403, 429].includes(e.status)) throw e;
      if (e.status === 404 || e.status === 410) {
        out.push({
          ...offer,
          description: [
            offer.description,
            'ISBN: strona oferty niedostępna (HTTP ' + e.status + ').',
          ]
            .filter(Boolean)
            .join('\n'),
        });
        continue;
      }
      if (options.bestEffort === true && !e.blocked) {
        out.push({
          ...offer,
          description: [
            offer.description,
            'ISBN: odczyt szczegółów chwilowo niedostępny; wymagane ponowne sprawdzenie.',
          ]
            .filter(Boolean)
            .join('\n'),
        });
        continue;
      }
      throw e;
    }
    // A changed schema is distinct from a missing ISBN. Do not block the
    // whole scan or claim that Vinted supplied no ISBN.
    if (detail.recognized === false) {
      out.push({
        ...offer,
        description: [
          offer.description,
          'ISBN: nie rozpoznano struktury danych konkretnej oferty Vinted.',
        ]
          .filter(Boolean)
          .join('\n'),
      });
      continue;
    }
    const raw = detail.isbnDetection?.observations || [];
    const observed = raw.length
      ? {
          parameters: {
            ...(offer.parameters || {}),
            'Odczyt ISBN': raw.map((o) => 'ISBN: ' + o.value).join('\n'),
          },
        }
      : {};
    out.push({
      ...offer,
      ...observed,
      ...(detail.isbn
        ? { isbn: detail.isbn, isbnEvidence: 'Vinted — szczegóły konkretnej oferty' }
        : {}),
      description: [
        offer.description,
        detail.isbn
          ? 'ISBN odczytany ze szczegółów oferty.'
          : detail.isbnDetection?.status === 'missing'
            ? 'ISBN: brak numeru w odczytanej publicznej odpowiedzi.'
            : 'ISBN w szczegółach wymaga kontroli: ' + detail.isbnDetection?.status + '.',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }
  return out;
}
