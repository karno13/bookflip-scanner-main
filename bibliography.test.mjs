import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitBnTitle,
  parseBnPeople,
  cleanPublisher,
  describeCandidate,
  differingFields,
  tidyOfferTitle,
  isbnCover,
} from './app/core/bibliography.js';

test('BN title is split into title, series and volume', () => {
  const parts = splitBnTitle('Pomniejsze bóstwa / Small gods, Wielka kolekcja ; 28 Discworld series');
  assert.equal(parts.title, 'Pomniejsze bóstwa');
  assert.equal(parts.series, 'Wielka kolekcja');
  assert.equal(parts.volume, 28);
  assert.equal(parts.cycle, 'Discworld');
});

test('BN people are readable and deduplicated', () => {
  assert.deepEqual(
    parseBnPeople('Pratchett, Terry (1948-2015) Cholewa, Piotr W. (1955- ) Prószyński Media Pratchett, Terry (1948-2015).'),
    ['Terry Pratchett', 'Piotr W. Cholewa'],
  );
  assert.deepEqual(parseBnPeople('Counter, Ben Kowalczyk, Krzysztof Copernicus Corporation'), [
    'Ben Counter',
    'Krzysztof Kowalczyk',
  ]);
  assert.deepEqual(parseBnPeople('', ['Madeleine Roux']), ['Madeleine Roux']);
});

test('publisher repeats and BN fragments are removed', () => {
  assert.equal(cleanPublisher('Copernicus Corporation Copernicus Corporation,'), 'Copernicus Corporation');
  assert.equal(cleanPublisher('Prószyński Media Prószyński i S-ka : partner kolekc'), 'Prószyński Media Prószyński i S-ka');
});

test('only differing facts are highlighted', () => {
  const items = [
    describeCandidate({ title: 'A', publicationYear: '2022', publisher: 'X' }),
    describeCandidate({ title: 'A', publicationYear: '2016', publisher: 'X' }),
  ];
  assert.deepEqual([...differingFields(items)], ['year']);
});

test('offer title noise and ISBN cover URL', () => {
  assert.equal(tidyOfferTitle('Wolni Ciut Ludzie T. 39 OPIS UNIKAT KRK'), 'Wolni Ciut Ludzie T. 39 OPIS KRK');
  assert.match(
    isbnCover('978-83-8391-392-6'),
    /^\/api\/image\?u=https%3A%2F%2Fcovers\.openlibrary\.org%2Fb%2Fisbn%2F9788383913926-M\.jpg/,
  );
  assert.equal(isbnCover('123'), null);
});
