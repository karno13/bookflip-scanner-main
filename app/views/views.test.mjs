import test from 'node:test';
import assert from 'node:assert/strict';
import { createScannerView } from './scanner.js';
import { createSettingsView } from './settings.js';

test('scanner reset initializes task counts without fetching external data', () => {
  const elements = new Map();
  const $ = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      dataset: {}, style: {}, className: '', textContent: '', innerHTML: '', hidden: true,
    });
    return elements.get(selector);
  };
  const state = { scan: { rows: new Map(), total: 0, completed: 0 } };
  const view = createScannerView({
    state, $, escapeHtml: String, shortTime: () => '-',
    readQueries: () => [], selectedSources: () => [], toast: () => {},
    loadHistory: () => {}, loadCatalogStatus: () => {}, loadCatalogData: () => {},
    storage: { setItem() {} },
  });
  view.resetScanUi(['one', 'two'], ['Vinted', 'Allegro']);
  assert.equal(state.scan.total, 4);
  assert.equal(state.scan.rows.size, 2);
  assert.equal($('#scanProgressPanel').hidden, false);
  view.updateProgress({ type: 'source-start', source: 'Vinted', query: 'one' });
  assert.equal(state.scan.rows.get('Vinted').status, 'Skanowanie');
});

test('settings view re-enables diagnostics button after a failed request', async () => {
  const elements = new Map();
  const $ = (selector) => {
    if (!elements.has(selector)) elements.set(selector, { disabled: false, innerHTML: '' });
    return elements.get(selector);
  };
  const view = createSettingsView({
    state: { catalog: {} }, $, escapeHtml: String,
    loadCatalogStatus: () => {},
    fetcher: async () => { throw Error('OFFLINE'); },
    clock: { now: () => 1 },
  });
  await view.runDiagnostics();
  assert.equal($('#runDiagnostics').disabled, false);
  assert.match($('#diagnosticResults').innerHTML, /ERR/);
});
