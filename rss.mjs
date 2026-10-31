import { queryText, matchesTopic, excludesProduct } from './search-policy.mjs';
// Only the publisher's explicitly offered Atom feed, never listing pages.
export function sprzedajemyFeedUrl(task) {
  const u = new URL('https://sprzedajemy.pl/lista-ofert.atom');
  u.searchParams.set('inp_category_id', '5');
  u.searchParams.set('inp_location_id', '1');
  u.searchParams.set('inp_text[v]', queryText(task));
  u.searchParams.set('inp_text[n]', '1');
  u.searchParams.set('sort', 'inp_srt_score_d');
  return u.href;
}
const entities = (s) =>
  s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, (x) => {
    const map = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&apos;': "'",
      '&nbsp;': ' ',
    };
    if (map[x]) return map[x];
    const n = parseInt(
      x.slice(x[2]?.toLowerCase() === 'x' ? 3 : 2, -1),
      x[2]?.toLowerCase() === 'x' ? 16 : 10,
    );
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
const plain = (s) =>
  entities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '')).trim();
const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const tag = (s, t) =>
  s.match(new RegExp('<' + t + '\\b[^>]*>([\\s\\S]*?)</' + t + '>', 'i'))?.[1] || '';
export function parseSprzedajemyAtom(xml, task, now = Date.now()) {
  if (
    typeof xml !== 'string' ||
    xml.length > 1000000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    !/<feed\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(xml) ||
    !/<\/feed>\s*$/.test(xml)
  )
    throw Error('INVALID_ATOM_FEED');
  const feedTime = Date.parse(
    plain(
      tag(
        xml.slice(0, xml.indexOf('<entry>') < 0 ? xml.length : xml.indexOf('<entry>')),
        'updated',
      ),
    ),
  );
  if (!Number.isFinite(feedTime) || feedTime > now + 60000 || now - feedTime > 86400000)
    throw Error('STALE_ATOM_FEED');
  const out = [],
    seen = new Set();
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const entry = match[1],
      title = plain(tag(entry, 'title')),
      summary = tag(entry, 'summary');
    // Restrict to the publisher's Books category. Game miniatures and PC games are excluded.
    if (
      !/<category\b[^>]*scheme=["']https:\/\/sprzedajemy\.pl\/kultura-i-rozrywka\/ksiazki-i-podreczniki(?:\/[^"']*)?["']/i.test(
        entry,
      )
    )
      continue;
    if (!title || title.length > 500 || excludesProduct(title)) continue;
    const relevant = matchesTopic(task, title);
    if (!relevant) continue;
    const priceText = summary.match(
      /<strong>\s*cena:\s*<\/strong>\s*([0-9\s\u00a0]+(?:[,.][0-9]{1,2})?)\s*zł/i,
    )?.[1];
    if (!priceText) continue;
    const price = Math.round(Number(priceText.replace(/[\s\u00a0]/g, '').replace(',', '.')) * 100);
    if (!Number.isSafeInteger(price) || price <= 0 || price > 100000000) continue;
    let url;
    try {
      url = new URL(plain(tag(entry, 'id')));
    } catch {
      continue;
    }
    if (
      url.origin !== 'https://sprzedajemy.pl' ||
      url.username ||
      url.password ||
      !/-nr\d+$/.test(url.pathname)
    )
      continue;
    url.search = '';
    url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    out.push({
      title,
      url: url.href,
      price,
      observedAt: new Date(now).toISOString(),
      sourceUpdatedAt: plain(tag(entry, 'updated')),
      activeConfirmed: false,
      priceConfirmed: false,
      availability: 'unconfirmed',
      priceEvidence: 'publisher_atom_feed',
    });
    if (out.length >= 20) break;
  }
  return out;
}
