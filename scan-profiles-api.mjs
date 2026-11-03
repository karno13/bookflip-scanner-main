const allowedSources = new Set(['Allegro','Empik','Vinted','Allegro Lokalnie','OLX','Tezeusz.pl','Dedalus.pl']);
function fail(code, statusCode=400) { throw Object.assign(Error(code), {statusCode}); }
function validate(name, input) {
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 60)
    fail('INVALID_PROFILE_NAME');
  if (!input || !Array.isArray(input.queries) || !Array.isArray(input.sources) ||
      input.queries.length < 1 || input.queries.length > 10 ||
      input.sources.length < 1 || input.sources.length > allowedSources.size ||
      input.queries.some(q => typeof q !== 'string' || q !== q.trim() || !q || q.length > 120) ||
      input.sources.some(x => !allowedSources.has(x)) ||
      new Set(input.queries).size !== input.queries.length ||
      new Set(input.sources).size !== input.sources.length)
    fail('INVALID_SCAN_PROFILE');
}
export function listScanProfiles(repository) {
  return repository.database.prepare('SELECT name,queries_json,sources_json,updated_at FROM scan_profiles ORDER BY name').all()
    .map(row => ({name:row.name, queries:JSON.parse(row.queries_json),
      sources:JSON.parse(row.sources_json), updatedAt:row.updated_at}));
}
export function putScanProfile(repository, name, input, {onlyIfAbsent=false} = {}) {
  validate(name,input);
  const db=repository.database;
  return repository.transaction(() => {
    const existing=db.prepare('SELECT 1 FROM scan_profiles WHERE name=?').get(name);
    if (existing && onlyIfAbsent) return {name,created:false};
    if (!existing && db.prepare('SELECT count(*) AS n FROM scan_profiles').get().n >= 30)
      fail('PROFILE_LIMIT_REACHED',409);
    const at=new Date().toISOString();
    if (onlyIfAbsent) {
      db.prepare('INSERT OR IGNORE INTO scan_profiles(name,queries_json,sources_json,updated_at) VALUES(?,?,?,?)')
        .run(name,JSON.stringify(input.queries),JSON.stringify(input.sources),at);
    } else {
      db.prepare(`INSERT INTO scan_profiles(name,queries_json,sources_json,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(name) DO UPDATE SET queries_json=excluded.queries_json,
        sources_json=excluded.sources_json,updated_at=excluded.updated_at`)
        .run(name,JSON.stringify(input.queries),JSON.stringify(input.sources),at);
    }
    return {name,created:!existing};
  });
}
export function deleteScanProfile(repository,name) {
  if (typeof name !== 'string' || !name || name.length > 60) fail('INVALID_PROFILE_NAME');
  return {removed:repository.database.prepare('DELETE FROM scan_profiles WHERE name=?').run(name).changes>0};
}
