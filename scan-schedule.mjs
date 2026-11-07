// Recurring scans of a saved profile, so the catalogue stays fresh without opening the app.
// The scheduler only decides *when*; the scan itself goes through the same endpoint (and the same
// single-scan guard, rate limits and safeguards) as a scan started from the interface.
import { request as httpRequest } from 'node:http';
import { listScanProfiles } from './scan-profiles-api.mjs';

const KEY = 'scan_schedule';
const MIN_HOURS = 1;
const MAX_HOURS = 168;

function fail(code, statusCode = 400) {
  throw Object.assign(Error(code), { statusCode });
}

export function getScanSchedule(repository) {
  const row = repository.database.prepare('SELECT value_json FROM app_preferences WHERE key=?').get(KEY);
  const saved = row ? JSON.parse(row.value_json) : {};
  return {
    enabled: saved.enabled === true,
    profile: typeof saved.profile === 'string' ? saved.profile : '',
    everyHours: Number.isFinite(saved.everyHours) ? saved.everyHours : 24,
    lastRunAt: saved.lastRunAt ?? null,
    lastResult: saved.lastResult ?? null,
  };
}

function store(repository, value, now) {
  repository.database
    .prepare(
      'INSERT INTO app_preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at',
    )
    .run(KEY, JSON.stringify(value), new Date(now).toISOString());
}

export function saveScanSchedule(repository, input, now = Date.now()) {
  const enabled = input?.enabled === true;
  const profile = typeof input?.profile === 'string' ? input.profile : '';
  const everyHours = Number(input?.everyHours);
  if (!Number.isInteger(everyHours) || everyHours < MIN_HOURS || everyHours > MAX_HOURS) fail('INVALID_SCHEDULE_INTERVAL');
  if (enabled && !listScanProfiles(repository).some((item) => item.name === profile)) fail('SCHEDULE_PROFILE_NOT_FOUND');
  const current = getScanSchedule(repository);
  store(repository, { enabled, profile, everyHours, lastRunAt: current.lastRunAt, lastResult: current.lastResult }, now);
  return getScanSchedule(repository);
}

/** When the next scan is due, or null when the schedule is off. */
export function nextRunAt(schedule) {
  if (!schedule.enabled || !schedule.profile) return null;
  const last = schedule.lastRunAt ? Date.parse(schedule.lastRunAt) : 0;
  return last + schedule.everyHours * 3_600_000;
}

export function createScanScheduler({
  getRepository,
  runScan,
  now = Date.now,
  checkEveryMs = 60_000,
  onEvent = () => {},
  setTimer = setInterval,
  clearTimer = clearInterval,
}) {
  let timer = null;
  let running = false;

  async function tick() {
    if (running) return { skipped: 'busy' };
    const repository = getRepository();
    if (!repository) return { skipped: 'no-catalog' };
    const schedule = getScanSchedule(repository);
    const due = nextRunAt(schedule);
    if (due === null) return { skipped: 'off' };
    if (now() < due) return { skipped: 'not-due' };
    const profile = listScanProfiles(repository).find((item) => item.name === schedule.profile);
    running = true;
    let result;
    try {
      if (!profile) result = 'profile-missing';
      else {
        const status = await runScan({ queries: profile.queries, sources: profile.sources });
        // 409: a manual scan is already running. Try again on the next check instead of doubling up.
        if (status === 409) return { skipped: 'scan-running' };
        result = status >= 200 && status < 300 ? 'ok' : `http-${status}`;
      }
    } catch (error) {
      result = `error:${String(error?.message ?? error).slice(0, 60)}`;
    } finally {
      running = false;
    }
    // Record the attempt even on failure so that a broken profile cannot be retried every minute.
    const fresh = getScanSchedule(repository);
    store(repository, { ...fresh, lastRunAt: new Date(now()).toISOString(), lastResult: result }, now());
    onEvent({ type: 'scheduled_scan', profile: schedule.profile, result });
    return { ran: true, result };
  }

  return {
    tick,
    start() {
      if (!timer) timer = setTimer(() => void tick().catch(() => {}), checkEveryMs);
      timer?.unref?.();
    },
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}

/** POSTs to this server's own scan endpoint exactly like the browser does. */
export function localScanRunner(port) {
  return (input) =>
    new Promise((resolve, reject) => {
      const body = JSON.stringify(input);
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/api/search',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Origin: `http://127.0.0.1:${port}`,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
}
