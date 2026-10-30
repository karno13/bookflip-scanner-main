export class SourceRateLimiter {
  constructor({ minIntervalMs = 1_000, now = () => Date.now(), wait = defaultWait } = {}) {
    if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) throw new TypeError('minIntervalMs must be non-negative');
    this.minIntervalMs = minIntervalMs;
    this.now = now;
    this.wait = wait;
    this.nextRequestAt = 0;
    this.queue = Promise.resolve();
  }

  async acquire() {
    const turn = this.queue.then(async () => {
      const delay = Math.max(0, this.nextRequestAt - this.now());
      if (delay) await this.wait(delay);
      this.nextRequestAt = this.now() + this.minIntervalMs;
    });
    this.queue = turn.catch(() => {});
    return turn;
  }
}

function defaultWait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(String(value).trim())) return Math.max(0, Math.ceil(Number(value) * 1_000));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

function temporaryNetworkError(error) {
  return ['AbortError', 'TimeoutError'].includes(error?.name) || error instanceof TypeError;
}

function errorDetails(error) { return { name: error?.name ?? 'Error', message: error?.message ?? String(error) }; }

export function createJsonRequester({
  fetcher = globalThis.fetch,
  limiter = new SourceRateLimiter(),
  timeoutMs = 8_000,
  retries = 2,
  retryBaseMs = 250,
  maxRetryAfterMs = 60_000,
  headers = {},
  wait = defaultWait,
  now = () => Date.now(),
} = {}) {
  if (typeof fetcher !== 'function') throw new TypeError('fetcher must be a function');
  return async function requestJson(url) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      await limiter.acquire();
      try {
        const response = await fetcher(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
        const status = Number(response.status);
        if (status === 404) return { status: 'not_found', httpStatus: status, url: response.url || url };
        if (status === 429 || status === 408 || status === 425 || status >= 500) {
          lastError = { kind: 'temporary_error', httpStatus: status, retryAfter: headerValue(response.headers, 'retry-after') };
          if (attempt < retries) {
            const retryAfter = parseRetryAfter(lastError.retryAfter, now());
            await wait(Math.min(maxRetryAfterMs, retryAfter ?? retryBaseMs * 2 ** attempt));
            continue;
          }
          return { status: 'temporary_error', ...lastError, url: response.url || url };
        }
        if (status < 200 || status >= 300) {
          return { status: 'invalid_response', httpStatus: status, reason: 'unexpected_http_status', url: response.url || url };
        }
        try {
          return { status: 'found', payload: await response.json(), httpStatus: status, url: response.url || url };
        } catch (error) {
          return { status: 'invalid_response', httpStatus: status, reason: 'invalid_json', error: errorDetails(error), url: response.url || url };
        }
      } catch (error) {
        if (!temporaryNetworkError(error)) {
          return { status: 'invalid_response', reason: 'request_failed', error: errorDetails(error), url };
        }
        lastError = { kind: 'temporary_error', error: errorDetails(error) };
        if (attempt < retries) {
          await wait(retryBaseMs * 2 ** attempt);
          continue;
        }
      }
    }
    return { status: 'temporary_error', ...lastError, url };
  };
}
