// One per-source request-start gate shared by listing pages and detail pages.
// A provider Retry-After delays ALL subsequent requests to that source, not just
// the operation which received the response. No CAPTCHA bypass or extra retries.
export function createMarketplaceGate({ intervalMs = 2000 } = {}) {
  const states = new Map();
  const get = (source) => {
    if (!states.has(source)) states.set(source, { nextAt: 0, cooldownUntil: 0, queue: Promise.resolve() });
    return states.get(source);
  };
  return {
    async acquire(source, { now = Date.now, pause, signal } = {}) {
      if (typeof pause !== 'function') throw TypeError('MARKETPLACE_PAUSE_REQUIRED');
      const state = get(source);
      const turn = state.queue.then(async () => {
        if (signal?.aborted) throw signal.reason || Error('ABORTED');
        const delay = Math.max(0, state.nextAt - now(), state.cooldownUntil - now());
        if (delay) await pause(delay, undefined, {signal});
        if (signal?.aborted) throw signal.reason || Error('ABORTED');
        state.nextAt = Math.max(state.nextAt, state.cooldownUntil, now()) + intervalMs;
      });
      state.queue = turn.catch(() => {});
      return turn;
    },
    cooldown(source, seconds, { now = Date.now } = {}) {
      if (!Number.isFinite(seconds) || seconds < 0) return;
      const state = get(source);
      state.cooldownUntil = Math.max(state.cooldownUntil, now() + Math.min(86400, seconds) * 1000);
    },
    snapshot(source) {
      const state = get(source);
      return { nextAt: state.nextAt, cooldownUntil: state.cooldownUntil };
    },
  };
}
export const sharedMarketplaceGate = createMarketplaceGate();
