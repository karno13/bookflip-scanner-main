import { readVintedISBN } from './vinted-detail.mjs';
const endpoint = 'https://bookflip.karnol13.chatgpt.site/api/github-scanner';
async function main() {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL || '');
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.actions.githubusercontent.com'))
    throw Error('OIDC_ENVIRONMENT_UNAVAILABLE');
  url.searchParams.set('audience', endpoint);
  const identity = await fetch(url, {
    headers: { Authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!identity.ok) throw Error('OIDC_TOKEN_UNAVAILABLE');
  const { value } = await identity.json();
  if (!value || !process.env.BOOKFLIP_SITES_ACCESS) throw Error('CREDENTIAL_UNAVAILABLE');
  async function api(body) {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + value,
            'OAI-Sites-Authorization': 'Bearer ' + process.env.BOOKFLIP_SITES_ACCESS,
          },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: AbortSignal.timeout(45000),
        });
        if (!r.ok) throw Error('SITE_HTTP_' + r.status);
        return await r.json();
      } catch (e) {
        if (i >= 2) throw e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  const until = Date.now() + 240000;
  let completed = 0;
  while (Date.now() < until - 50000) {
    const { task } = await api({ action: 'enrichClaim' });
    if (!task) break;
    let payload;
    try {
      const d = await readVintedISBN(task.url);
      payload = {
        isbn: d.isbn,
        recognized: d.recognized,
        uncertain: !['valid', 'missing'].includes(d.isbnDetection?.status),
      };
    } catch (e) {
      payload = {
        error: String(e.message).slice(0, 150),
        kind:
          e.blocked || e.status === 403
            ? 'blocked'
            : [404, 410].includes(e.status)
              ? 'missing'
              : 'temporary',
        retryAfterSeconds: e.retryAfter || 60,
      };
    }
    await api({ action: 'enrichComplete', id: task.id, token: task.token, ...payload });
    completed++;
    if (payload.kind === 'blocked' || payload.kind === 'temporary') break;
  }
  console.log(JSON.stringify({ enriched: completed }));
}
main().catch(() => {
  console.error('ENRICHMENT_RUN_FAILED');
  process.exitCode = 1;
});
