import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { retryIdentificationJobs } from './identification-retry.mjs';
import { createLocalAppServer } from './local-app.mjs';

test('retry repository changes eligible identification jobs and rejects invalid modes', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  const at = new Date().toISOString();
  try {
    repository.database.prepare(
      'INSERT INTO offers(id,source,normalized_url,created_at,updated_at) VALUES(?,?,?,?,?)'
    ).run('offer-1','test','https://example.org/a',at,at);
    repository.database.prepare(
      "INSERT INTO identification_jobs(id,offer_id,status,created_at,updated_at) VALUES(?,?,?,?,?)"
    ).run('job-1','offer-1','failed',at,at);
    assert.deepEqual(retryIdentificationJobs(repository,'failed'),{queued:1});
    assert.equal(repository.database.prepare('SELECT status FROM identification_jobs WHERE id=?').get('job-1').status,'queued');
    assert.deepEqual(retryIdentificationJobs(repository,'failed'),{queued:0});
    assert.throws(()=>retryIdentificationJobs(repository,'invalid'),/INVALID_RETRY_MODE/);
  } finally { repository.close(); }
});

test('lookup endpoints reject invalid ISBN before external catalog requests', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  const catalog = { repository, lookupIsbn: () => {throw Error('LOOKUP_MUST_NOT_RUN');},
    resolveIsbn: () => {throw Error('RESOLVE_MUST_NOT_RUN');} };
  const server = createLocalAppServer({ catalogProvider: () => catalog });
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const base='http://127.0.0.1:'+server.address().port;
  try {
    for (const endpoint of ['lookup-preview','lookup-confirm']) {
      for (const isbn of ['',null,'not-an-isbn','9780000000001']) {
        const response = await fetch(base+'/api/catalog/'+endpoint,{
          method:'POST',headers:{Origin:base,'Content-Type':'application/json'},
          body:JSON.stringify({isbn}),
        });
        assert.equal(response.status,400,endpoint+' '+isbn);
        assert.deepEqual(await response.json(),{error:'INVALID_ISBN'});
      }
    }
  } finally {
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    repository.close();
  }
});
