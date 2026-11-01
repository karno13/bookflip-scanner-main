import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shell = await readFile(new URL('./app/app.js', import.meta.url), 'utf8');

test('every workspace receives both DOM selector helpers', async () => {
  for (const name of ['review', 'catalog', 'offers']) {
    const source = await readFile(new URL('./app/views/' + name + '.js', import.meta.url), 'utf8');
    const title = name[0].toUpperCase() + name.slice(1);
    assert.ok(source.includes('({ state, $, $$, json'), name + ' declaration');
    assert.ok(shell.includes('const ' + name + 'View = create' + title + 'View({ state, $, $$, json'), name + ' injection');
  }
  assert.ok(!shell.includes('state, $, $, json'));
});
