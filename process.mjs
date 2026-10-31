import { pathToFileURL } from 'node:url';
const ENDPOINT = 'https://bookflip.karnol13.chatgpt.site/api/github-scanner';

// A scheduled worker drains matching only. Marketplace requests never run here.
export async function drainProcessing(
  api,
  { now = Date.now, budgetMs = 4 * 60000, log = console.log } = {},
) {
  const stopAt = now() + budgetMs;
  let processed = 0,
    failed = 0,
    batches = 0,
    lastStatus = now(),
    state = await api({ action: 'status', worker: 'processing' });
  const pending = (s) =>
    Number(s.processing ?? (s.diagnostics?.queued || 0) + (s.diagnostics?.running || 0));
  if (state.automatic === false)
    return { processed, failed, batches, remaining: pending(state), reason: 'paused' };
  if (!pending(state)) return { processed, failed, batches, remaining: 0, reason: 'empty' };
  let reason = 'budget';
  while (now() < stopAt - 15000) {
    if (now() - lastStatus >= 30000) {
      state = await api({ action: 'status', worker: 'processing' });
      lastStatus = now();
      if (state.automatic === false) {
        reason = 'paused';
        break;
      }
    }
    const batch = await api({ action: 'process', worker: 'processing' });
    processed += batch.processed || 0;
    failed += batch.failed || 0;
    batches++;
    log(
      JSON.stringify({
        worker: 'processing',
        batch: batches,
        processed: batch.processed || 0,
        failed: batch.failed || 0,
        durationMs: batch.durationMs,
        claimed: batch.claimed,
        catalogLoadMs: batch.catalogLoadMs,
      }),
    );
    if (!(batch.processed || batch.failed)) {
      reason = 'waiting_or_empty';
      break;
    }
  }
  state = await api({ action: 'status', worker: 'processing' });
  return {
    processed,
    failed,
    batches,
    remaining: pending(state),
    reason: pending(state) ? reason : 'empty',
  };
}

async function main() {
  const access = process.env.BOOKFLIP_SITES_ACCESS;
  if (!access) throw Error('BOOKFLIP_SITES_ACCESS_MISSING');
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL || '');
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.actions.githubusercontent.com'))
    throw Error('OIDC_ENVIRONMENT_UNAVAILABLE');
  url.searchParams.set('audience', ENDPOINT);
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error('OIDC_TOKEN_UNAVAILABLE');
  const { value: token } = await response.json();
  if (!token) throw Error('OIDC_TOKEN_UNAVAILABLE');
  async function api(body) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'OAI-Sites-Authorization': 'Bearer ' + access,
            Authorization: 'Bearer ' + token,
          },
          redirect: 'error',
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(45000),
        });
        const data = await r.json();
        if (!r.ok || data.error) {
          console.error(
            JSON.stringify({
              httpStatus: r.status,
              code: data.error,
              traceId: data.traceId,
              action: body.action,
            }),
          );
          throw Object.assign(Error('SITE_HTTP_' + r.status), {
            transient: r.status >= 500 || r.status === 429,
          });
        }
        return data;
      } catch (e) {
        if (e.transient === false || attempt >= 2)
          throw Error(/^[A-Z0-9_]+$/.test(e.message) ? e.message : 'PROCESSING_CONNECTION_FAILED');
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
  }
  console.log(JSON.stringify({ worker: 'processing', ...(await drainProcessing(api)) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(
      JSON.stringify({
        error: /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'PROCESSING_RUNNER_FAILED',
      }),
    );
    process.exitCode = 1;
  });
