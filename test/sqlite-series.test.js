import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { listWorkSeries, updateWorkSeries } from '../work-series-api.mjs';

test('series annotations persist in SQLite, validate input and enforce work identity', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  const db = repository.database;
  const timestamp = new Date().toISOString();
  db.prepare("INSERT INTO works (id,title,authors_json,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run('test-work', 'Test work', '[]', timestamp, timestamp);
  assert.deepEqual(updateWorkSeries(repository,'test-work',{series:'Horus Heresy',volume:2}), {
    workId:'test-work',series:'Horus Heresy',volume:2
  });
  assert.equal(listWorkSeries(repository)[0].volume,2);
  assert.throws(() => updateWorkSeries(repository,'test-work',{series:'Horus',volume:0}), /INVALID_SERIES_ANNOTATION/);
  assert.throws(() => updateWorkSeries(repository,'missing',{series:'Horus',volume:2}), /WORK_NOT_FOUND/);
  assert.equal(updateWorkSeries(repository,'test-work',{series:'',volume:null}).series,null);
  assert.deepEqual(listWorkSeries(repository),[]);
  repository.close?.();
});
