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
  const diagnostics = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', msg => { if (msg.type() === 'error') diagnostics.push('console: ' + msg.text()); });
  page.on('requestfailed', request => diagnostics.push('request failed: ' + request.url() + ' ' + request.failure()?.errorText));
  page.on('response', response => { if (response.status() >= 400) diagnostics.push('HTTP ' + response.status() + ': ' + response.url()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => document.querySelector('#catalogWorks')?.textContent === '1', null, { timeout: 9000 });
  } catch (error) {
    const state = await page.evaluate(() => ({ catalog: document.querySelector('#catalogWorks')?.textContent, status: document.querySelector('#databaseStatus')?.textContent, connection: document.querySelector('#connectionLabel')?.textContent, toasts: document.querySelector('#toastRegion')?.textContent }));
    throw new Error('Catalog boot smoke failed: ' + JSON.stringify({state, errors, diagnostics, logs, reason: error.message}));
  }
  for (const view of ['scanner', 'review', 'catalog', 'sets', 'offers', 'settings']) {
    await page.locator(`.sidebar [data-view="${view}"]`).click();
    await assert.equal(await page.locator(`#view-${view}`).isVisible(), true, `view ${view}`);
  }
  // Exercise real P0 flows instead of merely checking that views appear.
  await page.locator('.sidebar [data-view="catalog"]').click();
  await page.locator('#catalogList [data-catalog-id]').first().click();
  await page.locator('#catalogDetail [data-edition-detail]').first().click();
  assert.equal(await page.locator('#backToWork').isVisible(), true, 'edition details must open');

  await page.locator('.sidebar [data-view="offers"]').click();
  await page.locator('#offersTableBody [data-offer-id]').first().click();
  await page.locator('#offerDrawerContent .offer-workspace').waitFor();
  assert.equal(await page.locator('#scenarioPurchase').inputValue(), '25', '2500 grosze displays as 25 PLN');
  await page.locator('#scenarioShipping').fill('5');
  await page.locator('#scenarioOther').fill('2');
  await page.locator('#scenarioResale').fill('40');
  const scenario = await page.locator('#scenarioResult').textContent();
  assert.match(scenario, /32,00/, 'purchase + delivery + costs in PLN');
  assert.match(scenario, /8,00/, 'profit in PLN');
  await page.locator('.offer-workspace input[type="number"]').fill('30');
  await page.locator('.offer-workspace button').click();
  await page.waitForFunction(() => document.querySelector('.offer-workspace small[role="status"]')?.textContent?.includes('Zapisano'));
  const workspace = await (await page.request.get(url + '/api/offer-workspace')).json();
  assert.equal(workspace.items.length, 1);
  assert.equal(workspace.items[0].targetReached, false, 'target signal requires watched offer');
  await page.locator('.offer-workspace input[type="checkbox"]').check();
  await page.waitForFunction(async () => {
    const r = await fetch('/api/offer-workspace');
    return (await r.json()).items?.[0]?.targetReached === true;
  });

  // P1: scanner profiles must be durable across a browser reload.
  await page.locator('.sidebar [data-view="scanner"]').click();
  await page.locator('#queries').fill('Solaris');
  await page.locator('#sourceGrid input[type="checkbox"]').first().check();
  await page.locator('.scan-profiles input[aria-label="Nazwa nowego profilu"]').fill('Profil testowy');
  await page.locator('.scan-profiles button').filter({hasText:'Zapisz profil'}).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.scan-profiles select option')].some(o => o.value === 'Profil testowy'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => [...document.querySelectorAll('.scan-profiles select option')].some(o => o.value === 'Profil testowy'));
  const stored = await (await page.request.get(url + '/api/offer-workspace')).json();
  assert.equal(stored.items[0].targetReached, true, 'target price survives reload');
  await page.locator('.sidebar [data-view="review"]').click();
  await assert.equal(await page.locator('#reviewList .review-item').count() > 0, true, 'nonempty review');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const view of ['scanner', 'review', 'catalog', 'sets', 'offers', 'settings']) {
    const tab = page.locator(`.mobile-bottom-nav [data-view="${view}"]`);
    assert.equal(await tab.isVisible(), true, `mobile tab ${view} should be visible`);
    await tab.click();
    assert.equal(await page.locator(`#view-${view}`).isVisible(), true, `mobile view ${view}`);
    assert.equal(await tab.getAttribute('aria-current'), 'page', `current mobile tab ${view}`);
  }
  assert.equal(await page.locator('.sidebar').isVisible(), false, 'desktop sidebar hidden on phone');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal page overflow on phone');
  assert.deepEqual(errors, [], 'Unexpected frontend exceptions');
  console.log('Browser smoke passed: all six views, nonempty SQLite, no JS page errors');
} finally {
  if (browser) await browser.close();
  if (server) { server.kill(); await pause(250); }
  await rm(directory, { recursive: true, force: true });
}
