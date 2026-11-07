import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleFromTitle, universeOf, stripOriginalTitle, catalogSeries, phraseLabel, setWorkUniverse } from './catalog-series.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('cycle and volume are read from BN series statements', () => {
  assert.deepEqual(cycleFromTitle('Dziedzictwo / Legacy, Legenda Drizzta ; ks. 7 Forgotten Realms'), { cycle: 'Legenda Drizzta', volume: 7 });
  assert.deepEqual(cycleFromTitle('Noc oka / Night of the eye, Dragonlance Saga. Obrońcy Magii t. 1'), { cycle: 'Obrońcy Magii', volume: 1 });
  assert.deepEqual(
    cycleFromTitle('Ucieczka "Eisensteina" : herezja trwa / Flight of the Eisenstein, Herezja Horusa ; 4 Warhammer 40.000 Herezja Horusa 4'),
    { cycle: 'Herezja Horusa', volume: 4 },
  );
  assert.deepEqual(cycleFromTitle('Gwardia honorowa / Honour guard, Duchy Gaunta t. 6 Czarna Biblioteka 41'), { cycle: 'Duchy Gaunta', volume: 6 });
  // The universe itself numbered: volume without a cycle. Publisher collections are not cycles.
  assert.deepEqual(cycleFromTitle('Ciekawe czasy / Interesting times, Discworld series t. 14'), { cycle: null, volume: 14 });
  assert.equal(cycleFromTitle('Złodziej czasu / Thief of time, Discworld series Wielka kolekcja ; 26'), null);
  assert.equal(cycleFromTitle('Kosiarz'), null);
});

test('original title running into the series name is cut off', () => {
  assert.equal(stripOriginalTitle("Halfling's gem Legenda Drizzta"), 'Legenda Drizzta');
  assert.equal(stripOriginalTitle('Horus heresy Herezja Horusa'), 'Herezja Horusa');
  assert.equal(stripOriginalTitle('Przygody Gotreka i Felixa'), 'Przygody Gotreka i Felixa');
});

test('universe from title words or scan phrase', () => {
  assert.equal(universeOf('Zimistrz / Wintersmith, Discworld series t. 41'), 'Świat Dysku');
  assert.equal(universeOf('Illidan / World of Warcraft (Insignis Media)'), 'Warcraft');
  assert.equal(universeOf('Kosiarz'), null);
});

test('series tree groups works by universe and cycle with missing volumes', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    for (const [title, volume] of [['Strumienie srebra / Streams of silver, Legenda Drizzta ; ks. 5 Forgotten Realms', 5], ['Dziedzictwo / Legacy, Legenda Drizzta ; ks. 7 Forgotten Realms', 7]]) {
      const work = repository.createWork({ title, authors: ['R. A. Salvatore'] });
      repository.createEdition({ workId: work.id, title, publicationYear: 2000 + volume });
    }
    repository.createWork({ title: 'Kosiarz', authors: ['Terry Pratchett'] });
    const tree = catalogSeries(repository);
    assert.equal(tree[0].name, 'Forgotten Realms');
    assert.equal(tree[0].cycles[0].name, 'Legenda Drizzta');
    assert.deepEqual(tree[0].cycles[0].volumes, [5, 7]);
    assert.deepEqual(tree[0].cycles[0].missing, [1, 2, 3, 4, 6]);
    assert.equal(tree.at(-1).name, 'Poza seriami');
  } finally {
    repository.close?.();
  }
});

test('a scan phrase that misspells the author is shown as the author', () => {
  assert.equal(phraseLabel('Terry Prachet', ['Pratchett, Terry (1948-2015)']), 'Terry Pratchett');
  assert.equal(phraseLabel('Terry Prachet', ['Pratchett, Terry (1948-2015) Cholewa, Piotr W. (1955- ) Prószyński i S-ka']), 'Terry Pratchett');
  assert.equal(phraseLabel('fantastyka', ['Pratchett, Terry']), 'Fantastyka');
});

test('operator moves a stray work to another universe and back', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const work = repo.createWork({ title: 'Warcraft : wojna starożytnych', authors: ['Knaak, Richard A.'] });
    repo.createEdition({ workId: work.id, title: 'Warcraft : wojna starożytnych' });
    const universeOfWork = () => catalogSeries(repo).find((universe) => universe.cycles.some((cycle) => cycle.works.some((item) => item.id === work.id)))?.name;
    assert.equal(universeOfWork(), 'Warcraft');
    setWorkUniverse(repo, work.id, { universe: 'Poza seriami' });
    assert.equal(universeOfWork(), 'Poza seriami');
    setWorkUniverse(repo, work.id, { universe: null });
    assert.equal(universeOfWork(), 'Warcraft');
    assert.throws(() => setWorkUniverse(repo, 'missing', { universe: 'X' }), /WORK_NOT_FOUND/);
  } finally {
    repo.close();
  }
});
