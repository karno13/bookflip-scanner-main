import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';

const directory = await mkdtemp(join(tmpdir(), 'bookflip-smoke-'));
const dbPath = join(directory, 'fixture.sqlite');
const port = 4391;
const url = `http://127.0.0.1:${port}`;
let server;
let browser;
try {
  const repo = new SqliteCatalogRepository(dbPath);
  try {
    const work = repo.createWork({ title: 'Solaris', authors: ['Stanisław Lem'] });
    const edition = repo.createEdition({ workId: work.id, title: 'Solaris', publisher: 'Testowe' });
    repo.attachIdentifier(edition.id, 'isbn13', '9780306406157', { source: 'smoke-test' });
    const offer = repo.upsertOffer({
      source: 'smoke-test', normalizedUrl: 'https://example.test/book',
      originalTitle: 'Solaris - egzemplarz testowy', currentPrice: 2500,
      observedIsbn: '9780306406157',
    });
    repo.putIdentificationJob({ offerId: offer.id, status: 'review_required' });
  } finally {
    repo.close();
  }
  server = spawn(process.execPath, ['local-app.mjs', '--no-open'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      BOOKFLIP_LOCAL_PORT: String(port),
      BOOKFLIP_CATALOG_DB: dbPath,
      BOOKFLIP_CATALOG_AUTO_RESOLVE: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  server.stdout.on('data', data => { logs += String(data); });
  server.stderr.on('data', data => { logs += String(data); });
  let online = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(url + '/api/catalog/status');
      if (response.ok) { online = true; break; }
    } catch {}
    await pause(150);
  }
  assert.ok(online, 'Server did not start: ' + logs);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#catalogWorks')?.textContent === '1', { timeout: 15000 });
  for (const view of ['scanner', 'review', 'catalog', 'offers', 'settings']) {
    await page.locator(`[data-view="${view}"]`).click();
    await assert.equal(await page.locator(`#view-${view}`).isVisible(), true, `view ${view}`);
  }
  await page.locator('[data-view="review"]').click();
  await assert.equal(await page.locator('#reviewList .review-item').count() > 0, true, 'nonempty review');
  assert.deepEqual(errors, [], 'Unexpected frontend exceptions');
  console.log('Browser smoke passed: all five views, nonempty SQLite, no JS page errors');
} finally {
  if (browser) await browser.close();
  if (server) { server.kill(); await pause(250); }
  await rm(directory, { recursive: true, force: true });
}
