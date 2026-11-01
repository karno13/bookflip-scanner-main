import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Sets uses master-detail navigation and accessible inline search', async () => {
  const html = await readFile(new URL('./app/index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('./app/views/sets.js', import.meta.url), 'utf8');
  for (const id of ['setList','setFilter','setSelectedTitle','setMembers','setEditionResults']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(js, /data-set-id/);
  assert.match(js, /data-add-edition/);
  assert.match(js, /data-set-remove/);
  assert.match(js, /await refreshSets\(activeId\)/);
  assert.match(js, /safe\(row\.title\)/);
});
