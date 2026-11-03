import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('scanner and shell display common Polish status labels with diacritics', async () => {
  const scanner = await readFile(new URL('../app/views/scanner.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
  const offers = await readFile(new URL('../app/views/offers.js', import.meta.url), 'utf8');
  assert.match(scanner, /Skan zakończony/);
  assert.match(scanner, /Weryfikacja języka/);
  assert.match(scanner, /Łączenie ze źródłem/);
  assert.doesNotMatch(scanner, /Zakonczony|Laczenie ze zrodlem|Weryfikacja jezyka/);
  assert.match(html, /Zakończono/);
  assert.match(offers, /Otwórz ogłoszenie/);
});
