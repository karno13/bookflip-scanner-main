import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shell = await readFile(new URL('./app/app.js', import.meta.url), 'utf8');
const offers = await readFile(new URL('./app/views/offers.js', import.meta.url), 'utf8');

test('navigation uses querySelectorAll helper in both menu paths', () => {
  assert.equal(shell.split("$$('.nav-item').forEach").length - 1, 2);
  assert.doesNotMatch(shell, /(?<!\$)\$\('\.nav-item'\)\.forEach/);
});
test('settings view is initialized before diagnostic listener', () => {
  const init = shell.indexOf('const { renderSettings, runDiagnostics } = createSettingsView(');
  const handler = shell.indexOf("$('#runDiagnostics').addEventListener('click', runDiagnostics)");
  assert.ok(init >= 0 && handler > init);
  assert.match(shell, /import \{ createSettingsView \} from '\.\/views\/settings\.js'/);
  assert.doesNotMatch(offers, /createSettingsView\(/);
});
test('scanner source renderer is available for other workspaces', () => {
  assert.match(shell, /const \{ startSearch, renderSourceRows \} = createScannerView\(/);
  for (const name of ['review', 'catalog', 'offers'])
    assert.ok(shell.includes('const ' + name + 'View = create' + name[0].toUpperCase() + name.slice(1) + 'View('));
});
