export async function dispatchContinuation(generation, token, request = fetch) {
  if (!Number.isSafeInteger(generation) || generation < 1) throw Error('INVALID_CONTINUATION');
  if (!token) throw Error('CONTINUATION_TOKEN_MISSING');
  const r = await request(
    'https://api.github.com/repos/PJASDEM/bookflip-scanner/actions/workflows/bookflip-scan.yml/dispatches',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main', inputs: { continuation: String(generation) } }),
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    },
  );
  if (!r.ok) throw Error('CONTINUATION_HTTP_' + r.status);
  await r.body?.cancel();
}
