// TTL-backed, bounded cache in the same SQLite catalog as scanned offers.
// Store only stable language/ISBN evidence, never HTML or failed responses.
export function createSqliteVintedDetailCache(repository, {
  now = Date.now, ttlMs = 6 * 60 * 60 * 1000, maxEntries = 3000,
} = {}) {
  const db = repository.database;
  const get = db.prepare('SELECT language,isbn,expires_at FROM vinted_detail_cache WHERE offer_url=?');
  const set = db.prepare(`INSERT INTO vinted_detail_cache
    (offer_url, language, isbn, expires_at, fetched_at) VALUES(?,?,?,?,?)
    ON CONFLICT(offer_url) DO UPDATE SET
      language=excluded.language,isbn=excluded.isbn,
      expires_at=excluded.expires_at,fetched_at=excluded.fetched_at`);
  const deleteExpired = db.prepare('DELETE FROM vinted_detail_cache WHERE expires_at <= ?');
  const trim = db.prepare(`DELETE FROM vinted_detail_cache WHERE offer_url IN
    (SELECT offer_url FROM vinted_detail_cache ORDER BY fetched_at DESC,offer_url DESC
    LIMIT -1 OFFSET ?)`);
  let insertions = 0;
  return {
    get(url) {
      const row = get.get(url);
      if (!row || row.expires_at <= now()) return undefined;
      return { language: row.language, ...(row.isbn ? {isbn: row.isbn} : {}) };
    },
    set(url, detail) {
      const language = typeof detail?.language === 'string' ? detail.language.trim() : '';
      if (!language || language.length > 100 || typeof url !== 'string' || url.length > 2048)
        return this;
      const isbn = typeof detail?.isbn === 'string' && detail.isbn.length <= 20 ? detail.isbn : null;
      set.run(url, language, isbn, now() + ttlMs, new Date(now()).toISOString());
      if (++insertions % 50 === 0) {
        deleteExpired.run(now());
        trim.run(maxEntries);
      }
      return this;
    },
    size() {
      return db.prepare('SELECT count(*) AS total FROM vinted_detail_cache WHERE expires_at > ?')
        .get(now()).total;
    },
  };
}
