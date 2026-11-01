import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('queue diagnostic fields are available', async () => {
 const backend = await readFile(new URL('./catalog-production.mjs', import.meta.url), 'utf8');
 const frontend = await readFile(new URL('./app/app.js', import.meta.url), 'utf8');
 for (const field of ['runnable', 'waiting', 'failureReasons']) assert.ok(backend.includes(field));
 assert.ok(frontend.includes('Gotowe do przetworzenia'));
 assert.ok(frontend.includes('Oczekujące na termin ponowienia'));
});
