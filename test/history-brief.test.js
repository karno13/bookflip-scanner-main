import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { historyBookLabels } from '../history-brief.mjs';

test('brief history reads only labels of actively matched editions', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  const db = repository.database;
  const at = new Date().toISOString();
  db.prepare('INSERT INTO works(id,legacy_id,title,authors_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('work-1','legacy-book','Moja książka','[]',at,at);
  db.prepare('INSERT INTO editions(id,work_id,title,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run('edition-1','work-1','Pierwsze wydanie',at,at);
  db.prepare('INSERT INTO offers(id,source,normalized_url,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run('offer-1','test','https://example.com/offer-1',at,at);
  db.prepare('INSERT INTO offer_matches(id,offer_id,edition_id,method,status,valid_from,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('match-1','offer-1','edition-1','manual','active',at,at);
  assert.deepEqual(historyBookLabels(repository), {
    books: [{book:{id:'legacy-book',title:'Pierwsze wydanie'}}],
  });
  db.prepare('UPDATE offer_matches SET status=? WHERE id=?').run('superseded','match-1');
  assert.deepEqual(historyBookLabels(repository), {books:[]});
  repository.close?.();
});
