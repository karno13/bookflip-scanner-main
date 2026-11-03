// Process-local positive cache; avoids refetching unchanged Vinted detail pages on each scan.
// Entries expire and the map is bounded so memory cannot grow indefinitely.
export function createVintedDetailCache({ttlMs = 6 * 60 * 60 * 1000, maxEntries = 3000, now = Date.now} = {}) {
 const entries = new Map();
 return {
   get(url) {
     const record = entries.get(url);
     if (!record) return undefined;
     if (record.expiresAt <= now()) { entries.delete(url); return undefined; }
     // Refresh LRU ordering on hit.
     entries.delete(url);
     entries.set(url, record);
     return record.detail;
   },
   set(url, detail) {
     const lang = typeof detail?.language === 'string' ? detail.language.trim() : '';
     // Do not cache failures/unknowns: they need to be retried next scan.
     if (!lang) return this;
     entries.delete(url);
     entries.set(url, {detail, expiresAt: now() + ttlMs});
     while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
     return this;
   },
   size: () => entries.size,
 };
}
