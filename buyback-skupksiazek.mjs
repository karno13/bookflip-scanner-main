// skupksiazek.pl has no quote API: its own "Wyceń" form adds the ISBN to an anonymous cart and reads the
// price from the cart item. We do the same, one ISBN at a time, and remove the item right after reading
// the quote so the cart stays empty. The price is the buyer's preliminary offer ("wstępna cena").
import { SourceRateLimiter } from './metadata-http.mjs';

export const SKUP_BASE = 'https://skupksiazek.pl';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BookFlip/1.0 (local catalogue)';

function cookieJar() {
  const jar = new Map();
  return {
    take(headers) {
      const list = typeof headers?.getSetCookie === 'function' ? headers.getSetCookie() : [];
      for (const line of list) {
        const [pair] = String(line).split(';');
        const at = pair.indexOf('=');
        if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
      }
    },
    get: (name) => jar.get(name),
    header: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
    clear: () => jar.clear(),
  };
}

const digits = (value) => String(value ?? '').replace(/\D/g, '');

// Turns the cart item for our ISBN into a quote. A missing item with an error message means the buyer
// does not take this book.
export function quoteFromCart(body, isbn) {
  const items = body?.cart?.items || [];
  const item = items.find((entry) => digits(entry.isbn || entry.item_isbn) === isbn);
  if (!item) return { status: 'not_bought', price: null, title: null, message: body?.message || null, item: null };
  const price = Number(item.price);
  const title = [item.title, item.author].filter(Boolean).join(' — ') || null;
  if (item.exceeds_client_price_limit || !Number.isFinite(price) || price <= 0)
    return { status: 'manual', price: null, title, message: item.comment || 'Wycena ręczna przez skup', item };
  const quantity = Number(item.quantity) > 1 ? Number(item.quantity) : 1;
  return { status: 'priced', price: Math.round((price / quantity) * 100) / 100, title, message: item.comment || null, item };
}

export function createSkupksiazekClient({ fetch: fetchImpl = globalThis.fetch, minIntervalMs = 8_000, timeoutMs = 20_000 } = {}) {
  const limiter = new SourceRateLimiter({ minIntervalMs });
  const jar = cookieJar();
  let csrf = null;
  let cartCode = '0';

  async function call(path, { method = 'GET', body } = {}) {
    const headers = { 'User-Agent': USER_AGENT, Accept: method === 'GET' && path === '/' ? 'text/html' : 'application/json', 'Accept-Language': 'pl-PL,pl;q=0.9' };
    const cookies = jar.header();
    if (cookies) headers.Cookie = cookies;
    if (method !== 'GET') {
      headers['X-Requested-With'] = 'XMLHttpRequest';
      headers['Content-Type'] = 'application/json';
      headers.Origin = SKUP_BASE;
      headers.Referer = SKUP_BASE + '/';
      if (csrf) headers['X-CSRF-TOKEN'] = csrf;
      const xsrf = jar.get('XSRF-TOKEN');
      if (xsrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf);
    }
    const response = await fetchImpl(SKUP_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    jar.take(response.headers);
    return response;
  }

  async function openSession() {
    jar.clear();
    cartCode = '0';
    await limiter.acquire();
    const response = await call('/');
    if (!response.ok) throw Object.assign(new Error(`skupksiazek.pl: HTTP ${response.status}`), { code: 'HTTP_' + response.status });
    csrf = (await response.text()).match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i)?.[1] || null;
    if (!csrf) throw Object.assign(new Error('skupksiazek.pl: brak tokenu formularza na stronie'), { code: 'NO_CSRF' });
  }

  async function readJson(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { message: null };
    }
  }

  async function quote(rawIsbn) {
    const isbn = digits(rawIsbn);
    if (isbn.length !== 13) throw Object.assign(new Error('Wycena wymaga ISBN-13'), { code: 'INVALID_ISBN' });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!csrf) await openSession();
      await limiter.acquire();
      const response = await call('/cart/' + encodeURIComponent(cartCode), { method: 'POST', body: { isbn } });
      // 419: session/CSRF expired; 404: the cart we reused is gone. Start over once.
      if ((response.status === 419 || response.status === 404) && attempt === 0) {
        csrf = null;
        continue;
      }
      if (response.status === 429 || response.status >= 500)
        throw Object.assign(new Error(`skupksiazek.pl: HTTP ${response.status}`), { code: 'HTTP_' + response.status, temporary: true });
      const body = await readJson(response);
      if (body?.cart?.code) cartCode = String(body.cart.code);
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && body?.message)
          return { status: 'not_bought', price: null, title: null, message: String(body.message).slice(0, 300) };
        throw Object.assign(new Error(`skupksiazek.pl: HTTP ${response.status}`), { code: 'HTTP_' + response.status });
      }
      const result = quoteFromCart(body, isbn);
      // Leave the cart as we found it. A failed removal does not invalidate the quote.
      for (const item of (body.cart?.items || []).filter((entry) => digits(entry.isbn || entry.item_isbn) === isbn)) {
        try {
          await limiter.acquire();
          const removed = await call(`/cart/${encodeURIComponent(cartCode)}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          await removed.text();
        } catch {
          // Next quote reuses the same cart; the item simply stays there.
        }
      }
      const { item, ...quoteOnly } = result;
      return quoteOnly;
    }
    throw Object.assign(new Error('skupksiazek.pl odrzuca sesję (CSRF)'), { code: 'CSRF' });
  }

  return { quote };
}
