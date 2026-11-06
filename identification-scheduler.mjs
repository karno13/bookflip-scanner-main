// Runs due identification jobs after a restart and at a bounded cadence.
// A single process never overlaps two batches. Retry scheduling and expired
// lease reclamation remain the responsibility of IdentificationWorker.
export function createIdentificationScheduler({
  runBatch,
  onResult = () => {},
  onError = () => {},
  intervalMs = 30_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  yieldFn = () => new Promise(resolve => setImmediate(resolve)),
  now = () => new Date(),
} = {}) {
  if (typeof runBatch !== 'function') throw Error('SCHEDULER_RUN_REQUIRED');
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 3_600_000)
    throw Error('INVALID_SCHEDULER_INTERVAL');
  let timer = null,
    active = null,
    stopped = false,
    paused = false,
    runStartedAt = null;
  const tick = () => {
    if (stopped || paused || active) return active || Promise.resolve(null);
    active = Promise.resolve()
      .then(async () => {
        let result;
        do {
          result = await runBatch();
          onResult(result);
          if (!result?.hasMore || stopped || paused) break;
          // Keep HTTP and pause responsive without an idle polling interval.
          await yieldFn();
        } while (!stopped && !paused);
        return result;
      })
      .catch((error) => {
        try {
          onError(error);
        } catch {}
        return null;
      })
      .finally(() => {
        active = null;
      });
    return active;
  };
  return {
    start({ newRun = false, startedAt = null } = {}) {
      if (stopped) throw Error('SCHEDULER_STOPPED');
      if (newRun || !runStartedAt) runStartedAt = startedAt || now().toISOString();
      paused = false;
      if (timer === null) {
        timer = setIntervalFn(() => {
          void tick();
        }, intervalMs);
        if (typeof timer?.unref === 'function') timer.unref();
      }
      void tick();
    },
    tick,
    status() {
      return {
        running: !stopped && !paused && timer !== null,
        active: Boolean(active),
        paused,
        stopping: paused && Boolean(active),
        runStartedAt,
      };
    },
    pause() {
      if (stopped) throw Error('SCHEDULER_STOPPED');
      paused = true;
      if (timer !== null) {
        clearIntervalFn(timer);
        timer = null;
      }
      // An already active batch is allowed to finish safely.
      return this.status();
    },
    async stop() {
      stopped = true;
      if (timer !== null) {
        clearIntervalFn(timer);
        timer = null;
      }
      if (active) await active;
    },
  };
}
