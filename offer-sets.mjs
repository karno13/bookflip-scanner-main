// A set is one marketplace offer containing several catalog editions.
// Price and inventory remain associated with the offer, not its members.
export function listOfferSets(repository) {
  const db = repository.database;
  const rows = db.prepare(`SELECT s.offer_id AS offerId, o.original_title AS title, o.source,
    o.current_price AS currentPrice, s.created_at AS createdAt
    FROM offer_sets s JOIN offers o ON o.id=s.offer_id ORDER BY s.updated_at DESC`).all();
  const editions = db.prepare(`SELECT se.offer_id AS offerId, se.edition_id AS editionId,
    e.title AS title, w.title AS workTitle
    FROM offer_set_editions se JOIN editions e ON e.id=se.edition_id
    JOIN works w ON w.id=e.work_id ORDER BY w.title,e.title`).all();
  return rows.map(row => ({ ...row, editions: editions.filter(item => item.offerId === row.offerId) }));
}

export function markOfferAsSet(repository, offerId) {
  return repository.transaction(() => {
    const db = repository.database;
    if (!db.prepare('SELECT id FROM offers WHERE id=?').get(offerId))
      throw Object.assign(Error('OFFER_NOT_FOUND'), { statusCode: 404 });
    const now = new Date().toISOString();
    db.prepare('INSERT INTO offer_sets(offer_id,created_at,updated_at) VALUES(?,?,?) ON CONFLICT(offer_id) DO UPDATE SET updated_at=excluded.updated_at').run(offerId, now, now);
    db.prepare("UPDATE offer_matches SET status='superseded',valid_to=? WHERE offer_id=? AND status='active'").run(now, offerId);
    db.prepare("UPDATE identification_jobs SET status='completed',run_after=NULL,lease_token=NULL,lease_expires_at=NULL,result_json=?,updated_at=? WHERE offer_id=?").run(JSON.stringify({ decision:'manual_set', reason:['offer_is_set'] }), now, offerId);
    return { offerId, status: 'set' };
  });
}

export function updateSetEdition(repository, offerId, editionId, include) {
  return repository.transaction(() => {
    const db = repository.database;
    if (!db.prepare('SELECT offer_id FROM offer_sets WHERE offer_id=?').get(offerId))
      throw Object.assign(Error('SET_NOT_FOUND'), { statusCode: 404 });
    if (!db.prepare('SELECT id FROM editions WHERE id=?').get(editionId))
      throw Object.assign(Error('EDITION_NOT_FOUND'), { statusCode: 404 });
    if (include)
      db.prepare('INSERT OR IGNORE INTO offer_set_editions(offer_id,edition_id,added_at) VALUES(?,?,?)').run(offerId, editionId, new Date().toISOString());
    else
      db.prepare('DELETE FROM offer_set_editions WHERE offer_id=? AND edition_id=?').run(offerId, editionId);
    db.prepare('UPDATE offer_sets SET updated_at=? WHERE offer_id=?').run(new Date().toISOString(), offerId);
    return { offerId, editionId, included: include };
  });
}

export function unmarkOfferSet(repository, offerId) {
  return repository.transaction(() => {
    const db = repository.database;
    const result = db.prepare('DELETE FROM offer_sets WHERE offer_id=?').run(offerId);
    if (!result.changes) throw Object.assign(Error('SET_NOT_FOUND'), { statusCode: 404 });
    db.prepare("UPDATE identification_jobs SET status='queued',run_after=NULL,result_json=NULL,updated_at=? WHERE offer_id=?").run(new Date().toISOString(), offerId);
    return { offerId, status: 'queued' };
  });
}
