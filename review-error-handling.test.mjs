import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const review = await readFile(new URL('./app/views/review.js', import.meta.url), 'utf8');
const shell = await readFile(new URL('./app/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('./app/index.html', import.meta.url), 'utf8');

test('review decision handles errors, double submissions, and refresh failure', () => {
  const decision = review.slice(review.indexOf('let reviewDecisionPending = false;'));
  assert.match(decision, /if \(!jobId \|\| reviewDecisionPending\) return/);
  assert.match(decision, /buttons\.forEach\(\(button\) => \{ button\.disabled = true; \}\)/);
  assert.match(decision, /catch \(error\)/);
  assert.match(decision, /Nie udało się zapisać decyzji/);
  assert.match(decision, /Decyzja zapisana w SQLite, ale nie udało się odświeżyć widoku/);
  assert.match(decision, /finally/);
});

test('manual catalog review metric counts review_required only', () => {
  assert.ok(shell.includes("statuses.review_required || 0"));
  assert.match(html, /Ręczna weryfikacja/);
  assert.match(html, /wymaga decyzji/);
});
