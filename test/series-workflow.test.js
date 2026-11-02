import test from 'node:test';
import assert from 'node:assert/strict';
import { readSeries, writeSeries, seriesSummary } from '../app/views/series.js';
function storage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key,value) => map.set(key,value) };
}
test('series notes roundtrip', () => {
  const local = storage();
  const notes = { a: { series: 'Horus', volume: 1 } };
  assert.equal(writeSeries(notes, local), true);
  assert.deepEqual(readSeries(local), notes);
});
test('series gap detection never invents missing titles', () => {
  const works = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const result = seriesSummary(works, {
    a: { series: 'Warcraft', volume: 1 },
    b: { series: 'Warcraft', volume: 3 },
    c: { series: 'Other', volume: 1 },
  });
  assert.deepEqual(result.find(group => group.name === 'Warcraft').missing, [2]);
  assert.deepEqual(result.find(group => group.name === 'Other').missing, []);
});
test('invalid stored data is ignored', () => {
  assert.deepEqual(readSeries({ getItem: () => '{bad' }), {});
  assert.equal(seriesSummary([{id:'a'}], {a:{series:'abc',volume:-1}}).length, 0);
});
