import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { applyCatalogMigrations, availableCatalogMigrations } from './catalog-migrations.mjs';

test('migration 105 drops stale not_found cache rows and requeues only not_found jobs', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,checksum TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT');
  for (const m of availableCatalogMigrations().filter((row) => row.version < 105)) {
    db.exec(m.sql);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(m.version, m.name, m.checksum, 'then');
  }
  const offer = (id) => db.prepare("INSERT INTO offers(id,source,normalized_url,original_title,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, 'Vinted', 'https://www.vinted.pl/items/' + id, 't', 'then', 'then');
  const job = (id, offerId, status, result) => db.prepare("INSERT INTO identification_jobs(id,offer_id,job_type,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id, offerId, 'identify_edition', status, result, 'then', 'then');
  for (const id of ['a', 'b', 'c']) offer(id);
  job('ja', 'a', 'completed', JSON.stringify({ decision: 'not_found' }));
  job('jb', 'b', 'completed', JSON.stringify({ decision: 'matched_existing' }));
  job('jc', 'c', 'review_required', JSON.stringify({ decision: 'review_required' }));
  db.prepare("INSERT INTO metadata_lookup_cache(source,lookup_key,status,response_json,payload_hash,fetched_at,expires_at) VALUES('bn','k1','not_found','{}','h','then','2999')").run();
  db.prepare("INSERT INTO metadata_lookup_cache(source,lookup_key,status,response_json,payload_hash,fetched_at,expires_at) VALUES('bn','k2','found','{}','h','then','2999')").run();

  assert.ok(applyCatalogMigrations(db).includes(105));

  const status = Object.fromEntries(db.prepare('SELECT offer_id,status FROM identification_jobs').all().map((r) => [r.offer_id, r.status]));
  assert.deepEqual(status, { a: 'queued', b: 'completed', c: 'review_required' });
  assert.deepEqual(db.prepare('SELECT lookup_key FROM metadata_lookup_cache').all().map((r) => r.lookup_key), ['k2']);
});
