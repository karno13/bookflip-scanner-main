import assert from 'node:assert/strict';
import test from 'node:test';
import { putScanProfile } from './scan-profiles-api.mjs';
import { createScanScheduler, getScanSchedule, nextRunAt, saveScanSchedule } from './scan-schedule.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

function setup() {
  const repo = new SqliteCatalogRepository(':memory:');
  putScanProfile(repo, 'Fantasy', { queries: ['Warcraft', 'Świat Dysku'], sources: ['Vinted'] });
  return repo;
}

test('the schedule is off by default and validates interval and profile', () => {
  const repo = setup();
  assert.equal(getScanSchedule(repo).enabled, false);
  assert.throws(() => saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 0 }), /INVALID_SCHEDULE_INTERVAL/);
  assert.throws(() => saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 999 }), /INVALID_SCHEDULE_INTERVAL/);
  assert.throws(() => saveScanSchedule(repo, { enabled: true, profile: 'Nie ma', everyHours: 24 }), /SCHEDULE_PROFILE_NOT_FOUND/);
  const saved = saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 12 });
  assert.deepEqual([saved.enabled, saved.profile, saved.everyHours], [true, 'Fantasy', 12]);
});

test('next run is due immediately when never run, then every N hours', () => {
  const repo = setup();
  const schedule = saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 6 });
  assert.equal(nextRunAt(schedule), 6 * 3_600_000, 'epoch + 6h, i.e. long overdue');
  assert.equal(nextRunAt({ ...schedule, enabled: false }), null);
  const ran = { ...schedule, lastRunAt: '2026-11-07T10:00:00.000Z' };
  assert.equal(nextRunAt(ran), Date.parse('2026-11-07T16:00:00.000Z'));
});

test('a due scan runs the saved profile once and records the attempt', async () => {
  const repo = setup();
  saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 6 });
  let clock = Date.parse('2026-11-07T12:00:00Z');
  const calls = [];
  const scheduler = createScanScheduler({
    getRepository: () => repo,
    runScan: async (input) => (calls.push(input), 200),
    now: () => clock,
  });
  assert.deepEqual(await scheduler.tick(), { ran: true, result: 'ok' });
  assert.deepEqual(calls, [{ queries: ['Warcraft', 'Świat Dysku'], sources: ['Vinted'] }]);
  assert.equal(getScanSchedule(repo).lastRunAt, '2026-11-07T12:00:00.000Z');
  assert.deepEqual(await scheduler.tick(), { skipped: 'not-due' });
  clock += 6 * 3_600_000;
  assert.equal((await scheduler.tick()).ran, true);
  assert.equal(calls.length, 2);
});

test('a manual scan in progress (409) is retried later without recording a run', async () => {
  const repo = setup();
  saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 1 });
  const scheduler = createScanScheduler({ getRepository: () => repo, runScan: async () => 409, now: () => Date.now() });
  assert.deepEqual(await scheduler.tick(), { skipped: 'scan-running' });
  assert.equal(getScanSchedule(repo).lastRunAt, null);
});

test('a failing scan is recorded, so a broken profile is not retried every minute', async () => {
  const repo = setup();
  saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 1 });
  const events = [];
  const scheduler = createScanScheduler({
    getRepository: () => repo,
    runScan: async () => {
      throw new Error('ECONNREFUSED');
    },
    now: () => Date.parse('2026-11-07T12:00:00Z'),
    onEvent: (event) => events.push(event),
  });
  const outcome = await scheduler.tick();
  assert.match(outcome.result, /^error:ECONNREFUSED/);
  assert.equal(getScanSchedule(repo).lastRunAt, '2026-11-07T12:00:00.000Z');
  assert.equal(events[0].type, 'scheduled_scan');
  assert.deepEqual(await scheduler.tick(), { skipped: 'not-due' });
});

test('an enabled schedule whose profile was deleted records "profile-missing" and does nothing else', async () => {
  const repo = setup();
  saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 1 });
  repo.database.prepare("DELETE FROM scan_profiles WHERE name='Fantasy'").run();
  let scans = 0;
  const scheduler = createScanScheduler({ getRepository: () => repo, runScan: async () => (scans++, 200), now: () => Date.now() });
  assert.equal((await scheduler.tick()).result, 'profile-missing');
  assert.equal(scans, 0);
});
