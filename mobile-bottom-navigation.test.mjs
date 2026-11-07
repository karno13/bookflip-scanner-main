import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile bottom navigation reaches all six BookFlip views', async () => {
  const html=await readFile(new URL('./app/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('./app/app.js',import.meta.url),'utf8');
  const nav=html.match(/<nav class="mobile-bottom-nav"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  for(const view of ['scanner','review','catalog','sets','offers','settings'])
    assert.match(nav,new RegExp('data-view="'+view+'"'));
  assert.match(app,/\.nav-item, \.mobile-nav-item/);
  assert.match(nav,/aria-label="Nawigacja mobilna"/);
});
test('mobile navigation supports safe area and visible focus', async () => {
  const css=(await Promise.all(['app.css'].map(file=>readFile(new URL('./app/'+file,import.meta.url),'utf8')))).join('\n');
  assert.match(css,/\.mobile-bottom-nav\{display:grid/);
  assert.match(css,/env\(safe-area-inset-bottom/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/\.sidebar\{display:none/);
});
