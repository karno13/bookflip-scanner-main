import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { mergeWorkGroup } from './trading-api.mjs';
import {
  findDuplicateWorkGroups,
  findWorkByKey,
  firstSurname,
  mainTitle,
  workKey,
} from './work-grouping.mjs';

test('main title drops the original title, series and volume parts of a BN record', () => {
  assert.equal(mainTitle('Para w ruch / Raising steam, Discworld series ; t. 40'), 'Para w ruch');
  assert.equal(mainTitle('Piekło pocztowe : powieść / Going postal'), 'Piekło pocztowe');
});

test('first surname handles BN "Surname, Name (years)" and "Name Surname"', () => {
  assert.equal(firstSurname(['Pratchett, Terry (1948-2015) Cholewa, Piotr W.']), 'pratchett');
  assert.equal(firstSurname(['Terry Pratchett']), 'pratchett');
  assert.equal(firstSurname([]), '');
});

test('the key needs both a title and an author, so authorless records never group', () => {
  assert.equal(workKey('Blask fantastyczny / Light fantastic', ['Pratchett, Terry']), 'blask fantastyczny|pratchett');
  assert.equal(workKey('Blask fantastyczny', ['Terry Pratchett']), 'blask fantastyczny|pratchett');
  assert.equal(workKey('Blask fantastyczny', []), null);
  assert.equal(workKey('AB', ['Terry Pratchett']), null);
  // A different book by the same author is a different key.
  assert.notEqual(workKey('Straż! Straż!', ['Pratchett, Terry']), workKey('Blask fantastyczny', ['Pratchett, Terry']));
});

function seed() {
  const repo = new SqliteCatalogRepository(':memory:');
  const work = (id, title, authors, editions = 1) => {
    repo.createWork({ id, title, normalizedTitle: title.toLowerCase(), authors, at: '2026-01-01T00:00:00Z' });
    for (let i = 0; i < editions; i++)
      repo.createEdition({ id: `${id}-e${i}`, workId: id, title, at: '2026-01-01T00:00:00Z' });
  };
  work('w1', 'Blask fantastyczny / Light fantastic', ['Pratchett, Terry (1948-2015)'], 2);
  work('w2', 'Blask Fantastyczny', ['Terry Pratchett']);
  work('w3', 'Straż! Straż!', ['Pratchett, Terry']);
  work('w4', 'Blask fantastyczny', ['Inny Autor']);
  return repo;
}

test('duplicate groups join reprints by the same author and ignore look-alikes by others', () => {
  const repo = seed();
  const groups = findDuplicateWorkGroups(repo);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].works.map((w) => w.id).sort(), ['w1', 'w2']);
  assert.equal(groups[0].targetId, 'w1', 'the work with more editions is kept');
  assert.equal(findWorkByKey(repo, 'Blask fantastyczny / Light fantastic', ['Pratchett, Terry'])?.id, undefined,
    'ambiguous key (two works) must not be silently reused');
  assert.equal(findWorkByKey(repo, 'Straż! Straż! / Guards! Guards!', ['Terry Pratchett'])?.id, 'w3');
});

test('merging a group moves editions and refuses works outside the group', () => {
  const repo = seed();
  assert.throws(() => mergeWorkGroup(repo, 'w1', ['w3']), /NOT_A_DUPLICATE_GROUP/);
  assert.throws(() => mergeWorkGroup(repo, 'w1', ['w4']), /NOT_A_DUPLICATE_GROUP/);
  const result = mergeWorkGroup(repo, 'w1', ['w2']);
  assert.equal(result.merged[0].merged, true);
  assert.equal(repo.database.prepare("SELECT work_id FROM editions WHERE id='w2-e0'").get().work_id, 'w1');
  assert.equal(findDuplicateWorkGroups(repo).length, 0, 'merged works disappear from duplicate groups');
});

test('merging works that own immutable external records succeeds and re-points the work-level link', () => {
  const repo = seed();
  // Real data: BN/Open Library records are tied to a work and the database forbids changing them.
  repo.database
    .prepare(
      "INSERT INTO external_records(id,provider,external_id,record_type,work_id,status,payload_hash,fetched_at,created_at) VALUES('x1','open_library','OL1W','work','w2','found','h','t','t')",
    )
    .run();
  repo.database
    .prepare("INSERT INTO external_record_links(external_record_id,work_id,edition_id,linked_at) VALUES('x1','w2',NULL,'t')")
    .run();
  mergeWorkGroup(repo, 'w1', ['w2']);
  const links = repo.database
    .prepare("SELECT work_id FROM external_record_links WHERE external_record_id='x1' ORDER BY work_id")
    .all()
    .map((row) => row.work_id);
  assert.deepEqual(links, ['w1', 'w2'], 'the target gains the link; the original stays as history');
});
