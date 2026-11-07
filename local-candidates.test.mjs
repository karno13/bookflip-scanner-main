import test from 'node:test';
import assert from 'node:assert/strict';
import { localEditionCandidates } from './catalog-api.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('offers without ISBN get catalogue editions of the same work; universe names alone do not match', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const illidan = repository.createWork({ title: 'World of Warcraft: Illidan', authors: ['William King'] });
    repository.createEdition({ workId: illidan.id, title: 'World of Warcraft: Illidan', publisher: 'Insignis', publicationYear: 2016 });
    const chronicle = repository.createWork({ title: 'World of Warcraft : kronika. T. 1', authors: ['Chris Metzen'] });
    repository.createEdition({ workId: chronicle.id, title: 'Kronika', publicationYear: 2019 });
    const found = localEditionCandidates(repository, 'WORLD OF WARCRAFT ILLIDAN WILLIAM KING PL');
    assert.equal(found.length, 1);
    assert.equal(found[0].workId, illidan.id);
    assert.equal(found[0].publicationYear, 2016);
    assert.ok(found[0].score >= 0.85);
    assert.deepEqual(localEditionCandidates(repository, 'World of Warcraft: Sylvanas'), []);
  } finally {
    repository.close?.();
  }
});
