import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shell = await readFile(new URL('./app/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('./app/index.html', import.meta.url), 'utf8');

test('workspace dependencies match their declarations', async () => {
  for (const name of ['review', 'catalog', 'offers']) {
    const source = await readFile(new URL('./app/views/' + name + '.js', import.meta.url), 'utf8');
    const capitalized = name[0].toUpperCase() + name.slice(1);
    const declaration = source.match(/export function \w+\(\{([^}]+)\}\)/);
    const initializer = shell.match(new RegExp('const ' + name + 'View = create' + capitalized + 'View\\(\\{([^}]+)\\}\\);'));
    assert.ok(declaration && initializer, name);
    const params = text => text.split(',').map(x => x.trim()).filter(Boolean);
    assert.deepEqual(params(initializer[1]), params(declaration[1]), name);
  }
});

test('startup feedback and source labels use Polish diacritics', () => {
  assert.match(html, /Wczytywanie źródeł/);
  assert.match(html, /Wszystkie źródła/);
  assert.match(shell, /Błąd połączenia/);
});
