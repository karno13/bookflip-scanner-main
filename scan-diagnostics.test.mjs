import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publicAssetPath } from './static-asset-path.mjs';
import { createScanDiagnostics, addScanEvent, scanProgress, scanTelemetry } from './scan-diagnostics.mjs';

test('diagnostics track source completion, errors and retries without storing offer contents', () => {
  const state = createScanDiagnostics({ queries: ['Horus', 'Warcraft'], sources: ['OLX', 'Vinted'] });
  addScanEvent(state, { type:'source-start', source:'OLX', query:'Horus' });
  addScanEvent(state, { type:'retry', source:'OLX', code:'RATE_LIMIT', attempt:1 });
  addScanEvent(state, { type:'source-error', source:'Vinted', code:'BLOCKED' });
  addScanEvent(state, { type:'source-done', source:'OLX', offers:4, status:'ok', secret:'should_not_persist' });
  assert.deepEqual(scanProgress(state), { completed:1, total:4, percent:25 });
  assert.equal(state.offersSeen, 4);
  assert.equal(state.retryCount, 1);
  assert.equal(state.errorCount, 1);
  assert.equal(state.sources.OLX.completed, 1);
  assert.doesNotMatch(JSON.stringify(state), /should_not_persist/);
});
test('diagnostic event history stays bounded and does not count unknown sources', () => {
  const state = createScanDiagnostics({ queries: ['one'], sources:['OLX'] });
  for (let i=0;i<100;i++) addScanEvent(state, { type:'page-done', source:'OLX', page:i });
  addScanEvent(state, { type:'source-done', source:'unselected', offers:100 });
  assert.equal(state.events.length,60);
  assert.equal(state.completedTasks,0);
  assert.equal(scanProgress(state).percent,0);
});
test('dashboard endpoint and view are wired to the local app', async () => {
  const app = await readFile(new URL('./local-app.mjs', import.meta.url),'utf8');
  const html = await readFile(new URL('./app/index.html', import.meta.url),'utf8');
  const frontend = await readFile(new URL('./app/app.js', import.meta.url),'utf8');
  assert.match(app, /\/api\/scan\/diagnostics/);
  assert.match(app, /addScanEvent\(currentScan\.diagnostics/);
  assert.match(app, /publicAssetPath\(url\.pathname\)/);
  assert.equal(publicAssetPath('/views/scan-insights.js'), 'views/scan-insights.js');
  assert.match(html, /id="scanInsightsSources"/);
  assert.match(frontend, /scanInsights\.refresh\(\)/);
});

test('telemetry estimates ETA only after at least two completed tasks', () => {
  const diagnostics = createScanDiagnostics({
    queries: ['A','B','C','D'], sources:['OLX'],
    startedAt:'2026-01-01T00:00:00.000Z',
  });
  addScanEvent(diagnostics, {type:'source-start',source:'OLX',query:'B',at:'2026-01-01T00:00:10.000Z'});
  addScanEvent(diagnostics, {type:'source-done',source:'OLX',offers:2,status:'ok',at:'2026-01-01T00:00:20.000Z'});
  let data = scanTelemetry(diagnostics,{running:true,now:Date.parse('2026-01-01T00:01:00.000Z')});
  assert.equal(data.etaSeconds,null);
  assert.equal(data.ratePerMinute,1);
  addScanEvent(diagnostics,{type:'source-done',source:'OLX',offers:1,status:'ok',at:'2026-01-01T00:00:30.000Z'});
  data = scanTelemetry(diagnostics,{running:true,now:Date.parse('2026-01-01T00:01:00.000Z')});
  assert.equal(data.etaSeconds,60);
  assert.equal(data.percent,50);
  assert.equal(data.quietSeconds,30);
  assert.equal(data.stalled,false);
});
test('telemetry flags lack of scan activity but does not claim stalled when finished', () => {
  const diagnostics=createScanDiagnostics({
    queries:['A'],sources:['Vinted'],startedAt:'2026-01-01T00:00:00.000Z',
  });
  const now=Date.parse('2026-01-01T00:02:01.000Z');
  assert.equal(scanTelemetry(diagnostics,{running:true,now}).stalled,true);
  assert.equal(scanTelemetry(diagnostics,{running:false,now}).stalled,false);
});
test('diagnostics UI includes current task, rate and ETA', async () => {
  const html=await readFile(new URL('./app/index.html',import.meta.url),'utf8');
  const view=await readFile(new URL('./app/views/scan-insights.js',import.meta.url),'utf8');
  for (const id of ['scanInsightsCurrent','scanInsightsRate','scanInsightsEta','scanInsightsNotice'])
    assert.match(html,new RegExp('id="' + id + '"'));
  assert.match(view,/telemetry\.etaSeconds/);
});
