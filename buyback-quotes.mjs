// Wholesale buyback floor per catalogue ISBN: cached quotes, on-demand checks and a slow background
// pass over the catalogue. Quotes are preliminary and expire after a week.
const SOURCE = 'skupksiazek';
export const QUOTE_TTL_MS = 7 * 24 * 3_600_000;
const ERROR_TTL_MS = 6 * 3_600_000;

const digits = (value) => String(value ?? '').replace(/\D/g, '');

function rowToQuote(row, now) {
  if (!row) return null;
  const age = now - Date.parse(row.checked_at);
  return {
    isbn: row.isbn13,
    status: row.status,
    price: row.price_pln ?? null,
    title: row.title ?? null,
    message: row.message ?? null,
    checkedAt: row.checked_at,
    stale: age > (row.status === 'error' ? ERROR_TTL_MS : QUOTE_TTL_MS),
  };
}

export function createBuybackService(repository, client, { now = () => Date.now(), batchLimit = 500 } = {}) {
  const db = repository.database;
  const read = db.prepare('SELECT * FROM buyback_quotes WHERE source=? AND isbn13=?');
  const write = db.prepare(`INSERT INTO buyback_quotes (source,isbn13,status,price_pln,title,message,checked_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(source,isbn13) DO UPDATE SET status=excluded.status,price_pln=excluded.price_pln,title=excluded.title,message=excluded.message,checked_at=excluded.checked_at`);
  const inflight = new Map();
  let batch = { state: 'idle', done: 0, total: 0, priced: 0, errors: 0, startedAt: null, finishedAt: null, lastError: null };
  let cancelled = false;

  function get(isbn) {
    return rowToQuote(read.get(SOURCE, digits(isbn)), now());
  }

  function many(isbns) {
    return Object.fromEntries(
      [...new Set(isbns.map(digits).filter((isbn) => isbn.length === 13))].map((isbn) => [isbn, get(isbn)]).filter(([, quote]) => quote),
    );
  }

  async function check(rawIsbn, { force = false } = {}) {
    const isbn = digits(rawIsbn);
    if (isbn.length !== 13) throw Object.assign(new Error('INVALID_ISBN'), { status: 400 });
    const cached = get(isbn);
    if (cached && !cached.stale && !force) return cached;
    if (inflight.has(isbn)) return inflight.get(isbn);
    const work = (async () => {
      let quote;
      try {
        quote = await client.quote(isbn);
      } catch (error) {
        // Keep a good older quote rather than overwrite it with a transient failure.
        if (cached && cached.status !== 'error') return { ...cached, refreshError: error.message };
        quote = { status: 'error', price: null, title: null, message: String(error.message || error).slice(0, 300) };
      }
      write.run(SOURCE, isbn, quote.status, quote.price ?? null, quote.title ?? null, quote.message ?? null, new Date(now()).toISOString());
      return get(isbn);
    })();
    inflight.set(isbn, work);
    try {
      return await work;
    } finally {
      inflight.delete(isbn);
    }
  }

  // Catalogue ISBNs without a fresh quote, editions with offers first.
  function pending() {
    const cutoff = new Date(now() - QUOTE_TTL_MS).toISOString();
    const errorCutoff = new Date(now() - ERROR_TTL_MS).toISOString();
    return db
      .prepare(
        `SELECT i.normalized_value AS isbn, count(m.offer_id) AS offers FROM edition_identifiers i
         LEFT JOIN offer_matches m ON m.edition_id=i.edition_id AND m.status='active'
         LEFT JOIN buyback_quotes q ON q.source=? AND q.isbn13=i.normalized_value
         WHERE i.scheme='isbn13' AND length(i.normalized_value)=13
           AND (q.isbn13 IS NULL OR (q.status<>'error' AND q.checked_at<?) OR (q.status='error' AND q.checked_at<?))
         GROUP BY i.normalized_value ORDER BY offers DESC, i.normalized_value LIMIT ?`,
      )
      .all(SOURCE, cutoff, errorCutoff, batchLimit)
      .map((row) => row.isbn);
  }

  function summary() {
    const row = db
      .prepare(
        `SELECT count(DISTINCT i.normalized_value) AS isbns,
           count(DISTINCT CASE WHEN q.status='priced' THEN q.isbn13 END) AS priced,
           count(DISTINCT CASE WHEN q.status='manual' THEN q.isbn13 END) AS manual,
           count(DISTINCT CASE WHEN q.status='not_bought' THEN q.isbn13 END) AS notBought
         FROM edition_identifiers i LEFT JOIN buyback_quotes q ON q.source=? AND q.isbn13=i.normalized_value
         WHERE i.scheme='isbn13' AND length(i.normalized_value)=13`,
      )
      .get(SOURCE);
    const total = db
      .prepare(`SELECT round(coalesce(sum(price_pln),0),2) AS value FROM buyback_quotes q WHERE q.source=? AND q.status='priced'
        AND EXISTS (SELECT 1 FROM edition_identifiers i WHERE i.scheme='isbn13' AND i.normalized_value=q.isbn13)`)
      .get(SOURCE).value;
    return { isbns: Number(row.isbns), priced: Number(row.priced), manual: Number(row.manual), notBought: Number(row.notBought), pricedValue: Number(total), pending: pending().length };
  }

  function status() {
    return { ...batch, summary: summary() };
  }

  function start() {
    if (batch.state === 'running') return status();
    const queue = pending();
    cancelled = false;
    batch = { state: 'running', done: 0, total: queue.length, priced: 0, errors: 0, startedAt: new Date(now()).toISOString(), finishedAt: null, lastError: null };
    void (async () => {
      let consecutiveErrors = 0;
      for (const isbn of queue) {
        if (cancelled) break;
        const quote = await check(isbn, { force: true }).catch((error) => ({ status: 'error', message: error.message }));
        batch.done += 1;
        if (quote.status === 'priced') batch.priced += 1;
        if (quote.status === 'error' || quote.refreshError) {
          batch.errors += 1;
          batch.lastError = quote.refreshError || quote.message;
          consecutiveErrors += 1;
          // The site is down or refusing us: stop instead of hammering it.
          if (consecutiveErrors >= 5) {
            batch.lastError = 'Przerwano po 5 błędach z rzędu: ' + batch.lastError;
            break;
          }
        } else consecutiveErrors = 0;
      }
      batch.state = cancelled ? 'cancelled' : 'finished';
      batch.finishedAt = new Date(now()).toISOString();
    })();
    return status();
  }

  function cancel() {
    cancelled = true;
    return status();
  }

  return { get, many, check, pending, summary, status, start, cancel };
}
