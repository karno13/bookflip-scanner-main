// Listing photos: validation of image URLs taken from marketplace data and a small local proxy with
// a disk cache. The browser only ever loads images from this server ('self'), so the page CSP stays
// strict and marketplace CDNs never see the BookFlip page as referrer.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const IMAGE_HOSTS = [
  /^([a-z0-9-]+\.)*allegroimg\.com$/,
  /^images\d*\.vinted\.net$/,
  /^([a-z0-9-]+\.)*olxcdn\.com$/,
  /^ecsmedia\.pl$/,
  /^static\d*\.tezeusz\.pl$/,
  /^tezeusz\.pl$/,
  /^dedalus\.pl$/,
  /^covers\.openlibrary\.org$/,
];
const MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif)$/;

export function imageHostAllowed(hostname) {
  return IMAGE_HOSTS.some((pattern) => pattern.test(String(hostname || '').toLowerCase()));
}

/** Returns a normalized https image URL from an allowed CDN, or null. Never throws. */
export function safeImageUrl(value) {
  if (Array.isArray(value)) value = value[0];
  if (value && typeof value === 'object') value = value.url || value.contentUrl || value['@id'];
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) return null;
  let url;
  try {
    url = new URL(value.trim().replace(/^\/\//, 'https://'));
  } catch {
    return null;
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!imageHostAllowed(url.hostname)) return null;
  if (/\.svg(?:$|\?)/i.test(url.pathname) || /no_picture|empty-photo|placeholder/i.test(url.pathname))
    return null;
  return url.href;
}

/** Local URL the frontend uses to show an image. */
export function proxiedImage(url) {
  const safe = safeImageUrl(url);
  return safe ? '/api/image?u=' + encodeURIComponent(safe) : null;
}

/** First image found in Open Graph / JSON-LD data of a product detail page. */
export function imageFromDetailHtml(html) {
  const text = String(html || '');
  for (const match of text.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = match[1];
    if (!/\b(?:property|name)\s*=\s*["'](?:og:image|og:image:url|twitter:image)["']/i.test(attrs)) continue;
    // Allegro Lokalnie writes the value unquoted: content=https://a.allegroimg.com/…
    const quoted = attrs.match(/\bcontent\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>]+))/i);
    const content = quoted?.[1] ?? quoted?.[2] ?? quoted?.[3];
    const safe = safeImageUrl(content?.replace(/&amp;/g, '&'));
    if (safe) return safe;
  }
  for (const match of text.matchAll(/"image"\s*:\s*(\[[^\]]*\]|\{[^}]*\}|"[^"]*")/g)) {
    try {
      const safe = safeImageUrl(JSON.parse(match[1]));
      if (safe) return safe;
    } catch {}
  }
  return null;
}

const inflight = new Map();

/**
 * Fetches an allowed image through a disk cache. Returns { body, type } or throws an error with
 * statusCode. Cached forever: listing photos are immutable per URL.
 */
export async function fetchCachedImage(raw, { cacheDirectory, fetcher = fetch } = {}) {
  const url = safeImageUrl(raw);
  if (!url) throw Object.assign(Error('IMAGE_URL_NOT_ALLOWED'), { statusCode: 400 });
  const key = createHash('sha256').update(url).digest('hex');
  const file = join(cacheDirectory, key.slice(0, 2), key);
  try {
    const [body, meta] = await Promise.all([readFile(file), readFile(file + '.type', 'utf8')]);
    if (IMAGE_TYPES.test(meta)) return { body, type: meta };
  } catch {}
  try {
    const missing = await stat(file + '.missing');
    if (Date.now() - missing.mtimeMs < 24 * 3600 * 1000)
      throw Object.assign(Error('IMAGE_NOT_FOUND'), { statusCode: 404 });
  } catch (error) {
    if (error.statusCode) throw error;
  }
  if (inflight.has(key)) return inflight.get(key);
  const task = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(url, {
        redirect: 'error',
        signal: controller.signal,
        headers: { accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8' },
      });
      const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!response.ok || !IMAGE_TYPES.test(type)) {
        await mkdir(join(cacheDirectory, key.slice(0, 2)), { recursive: true });
        await writeFile(file + '.missing', String(response.status));
        throw Object.assign(Error('IMAGE_NOT_FOUND'), { statusCode: 404 });
      }
      const length = Number(response.headers.get('content-length') || 0);
      if (length > MAX_BYTES) throw Object.assign(Error('IMAGE_TOO_LARGE'), { statusCode: 413 });
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_BYTES) throw Object.assign(Error('IMAGE_TOO_LARGE'), { statusCode: 413 });
      await mkdir(join(cacheDirectory, key.slice(0, 2)), { recursive: true });
      await writeFile(file, body);
      await writeFile(file + '.type', type);
      return { body, type };
    } catch (error) {
      if (error.statusCode) throw error;
      throw Object.assign(Error('IMAGE_FETCH_FAILED'), { statusCode: 502 });
    } finally {
      clearTimeout(timer);
    }
  })();
  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

const attempted = new Map();
const RETRY_MS = 6 * 3600 * 1000;

/**
 * Image of a stored offer. When the scan did not capture one (offers saved before migration 108),
 * reads the listing page once through the shared marketplace gate and stores og:image.
 */
export async function offerImageUrl(repository, offerId, { readHtml, now = Date.now } = {}) {
  const row = repository.database
    .prepare('SELECT id, source, normalized_url, image_url FROM offers WHERE id=?')
    .get(String(offerId));
  if (!row) return null;
  if (row.image_url) return row.image_url;
  const last = attempted.get(row.id);
  if (last && now() - last < RETRY_MS) return null;
  attempted.set(row.id, now());
  if (!readHtml) {
    const { readSourceHtml } = await import('./marketplaces.mjs');
    readHtml = (url, source) => readSourceHtml(url, { source });
  }
  try {
    const image = imageFromDetailHtml(await readHtml(row.normalized_url, row.source));
    if (!image) return null;
    repository.database
      .prepare('UPDATE offers SET image_url=? WHERE id=? AND image_url IS NULL')
      .run(image, row.id);
    return image;
  } catch {
    return null;
  }
}

const abortableWait = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Background fill of missing listing photos for offers stored before photos were captured.
 * One serial worker per source (the shared marketplace gate keeps each source polite); a source
 * that fails three times in a row is skipped for this run (captcha / 403 / listing gone). HTTP 429
 * means "slower", not "blocked": the worker waits (1, 2, 4 min) and retries the same offer.
 * Offers waiting for review go first, then catalog-linked ones, newest first.
 */
export function createImageBackfill(repository, { readHtml, limitPerSource = 400, throttleWaitMs = 60_000 } = {}) {
  let status = { state: 'idle', done: 0, filled: 0, failed: 0, total: 0, skippedSources: [], waitingSources: [], startedAt: null, finishedAt: null };
  let controller = null;
  const pending = () =>
    repository.database
      .prepare(
        `SELECT o.id, o.source, o.normalized_url FROM offers o
         LEFT JOIN identification_jobs j ON j.offer_id=o.id
         LEFT JOIN offer_matches m ON m.offer_id=o.id AND m.status='active'
         WHERE o.image_url IS NULL AND o.normalized_url LIKE 'https://%'
         ORDER BY (j.status='review_required') DESC, (m.offer_id IS NOT NULL) DESC, o.last_seen_at DESC`,
      )
      .all();
  async function run(signal) {
    if (!readHtml) {
      const { readSourceHtml } = await import('./marketplaces.mjs');
      readHtml = (url, source) => readSourceHtml(url, { source, signal });
    }
    const bySource = new Map();
    const seen = new Set();
    for (const row of pending()) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const list = bySource.get(row.source) || [];
      if (list.length < limitPerSource) list.push(row);
      bySource.set(row.source, list);
    }
    status.total = [...bySource.values()].reduce((sum, list) => sum + list.length, 0);
    const update = repository.database.prepare('UPDATE offers SET image_url=? WHERE id=? AND image_url IS NULL');
    await Promise.all(
      [...bySource].map(async ([source, list]) => {
        let streak = 0;
        let sourceFilled = 0;
        let throttled = 0;
        for (let index = 0; index < list.length; index++) {
          const row = list[index];
          if (signal.aborted) return;
          let image = null;
          try {
            image = imageFromDetailHtml(await readHtml(row.normalized_url, row.source));
            throttled = 0;
          } catch (error) {
            if (/HTTP_429/.test(String(error?.message)) && throttled < 3) {
              status.waitingSources.push(source);
              await abortableWait(throttleWaitMs * 2 ** throttled++, signal);
              status.waitingSources = status.waitingSources.filter((name) => name !== source);
              index--;
              continue;
            }
          }
          status.done++;
          if (image) {
            update.run(image, row.id);
            status.filled++;
            sourceFilled++;
            streak = 0;
          } else {
            status.failed++;
            // Blocked from the start → give up quickly; occasional dead listings are tolerated.
            if (++streak >= (sourceFilled ? 6 : 3)) {
              status.skippedSources.push(source);
              status.done += list.length - index - 1;
              return;
            }
          }
        }
      }),
    );
  }
  return {
    status: () => ({ ...status, skippedSources: [...status.skippedSources], waitingSources: [...status.waitingSources] }),
    start() {
      if (status.state === 'running') return this.status();
      controller = new AbortController();
      status = { state: 'running', done: 0, filled: 0, failed: 0, total: 0, skippedSources: [], waitingSources: [], startedAt: new Date().toISOString(), finishedAt: null };
      run(controller.signal)
        .catch(() => {})
        .finally(() => {
          status.state = controller.signal.aborted ? 'cancelled' : 'finished';
          status.finishedAt = new Date().toISOString();
        });
      return this.status();
    },
    cancel() {
      controller?.abort();
      return this.status();
    },
  };
}
