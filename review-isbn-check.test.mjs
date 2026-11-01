import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { normalizeISBN } from './isbn-normalization.mjs';

test('manual ISBN lookup recognizes an existing local edition including ISBN-10 alias', () => {
  const db = new SqliteCatalogRepository(':memory:');
  try {
    const work = db.createWork({ title: 'Solaris', authors: ['Stanisław Lem'] });
    const edition = db.createEdition({ workId: work.id, title: 'Solaris' });
    db.attachIdentifier(edition.id, 'isbn13', '9780306406157', { source: 'test' });
    assert.equal(db.findEditionByISBN(normalizeISBN('978-0-306-40615-7')).id, edition.id);
    assert.equal(db.findEditionByISBN(normalizeISBN('0306406152')).id, edition.id);
    assert.equal(db.findEditionByISBN(normalizeISBN('9788320000000')), null);
    assert.equal(normalizeISBN('not an isbn'), null);
  } finally {
    db.close();
  }
});

test('review lookup is read-only and does not silently approve an edition', async () => {
  const frontend = await readFile(new URL('./app/views/review.js', import.meta.url), 'utf8');
  const server = await readFile(new URL('./local-app.mjs', import.meta.url), 'utf8');
  assert.match(frontend, /id="reviewIsbnCheckButton"/);
  assert.match(frontend, /\/api\/catalog\/isbn-check/);
  assert.match(frontend, /Sprawdzenie nie zmienia przypisania/);
  assert.match(server, /url\.pathname === '\/api\/catalog\/isbn-check'/);
  assert.match(server, /repository\.findEditionByISBN\(isbn\)/);
  assert.doesNotMatch(frontend.match(/reviewIsbnCheckButton'\)\.addEventListener[\s\S]*?\n  \}\);/)?.[0] ?? '', /decideReview\(|approveReview\(/);
});
