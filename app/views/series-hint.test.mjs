import assert from 'node:assert/strict';
import test from 'node:test';
import { seriesHintForWork, seriesHintFromTitle } from './series.js';

test('series and volume are read from national-library style titles', () => {
  assert.deepEqual(
    seriesHintFromTitle('Mroczne oblężenie / Siege of darkness, Legenda Drizzta t. 9 Forgotten Realms'),
    { series: 'Legenda Drizzta', volume: 9 },
  );
  assert.deepEqual(
    seriesHintFromTitle('Smoki upadłego słońca / Dragons of autumm twilight, Wojna dusz ; t. 1 Dragonlance Saga'),
    { series: 'Wojna dusz', volume: 1 },
  );
  assert.deepEqual(seriesHintFromTitle('Wilcze ostrza / Kosmiczny Wilk. t. 4 Warhammer 40.000'), {
    series: 'Kosmiczny Wilk',
    volume: 4,
  });
});

test('titles without a volume marker give no hint instead of a guess', () => {
  assert.equal(seriesHintFromTitle('Blask fantastyczny / Light fantastic, Discworld series'), null);
  assert.equal(seriesHintFromTitle('Łups!'), null);
  assert.equal(seriesHintFromTitle(''), null);
  assert.equal(seriesHintFromTitle(null), null);
});

test('the work title is tried first, then each edition title', () => {
  const work = { title: 'Łups!', editions: [{ title: 'Łups! / Thud!, Świat Dysku t. 34' }] };
  assert.deepEqual(seriesHintForWork(work), { series: 'Świat Dysku', volume: 34 });
  assert.equal(seriesHintForWork({ title: 'Łups!', editions: [] }), null);
});
