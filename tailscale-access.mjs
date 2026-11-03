// Tailscale Serve is the ONLY supported remote entry point. Never bind the
// BookFlip HTTP server to LAN/tailnet interfaces or accept Funnel traffic.
const hostPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/;

export function tailscaleAccessFromEnv(env = process.env) {
  const rawHost = String(env.BOOKFLIP_TAILSCALE_HOST || '').trim();
  const rawUser = String(env.BOOKFLIP_TAILSCALE_USER || '').trim();
  if (!rawHost && !rawUser) return null;
  const host = rawHost.toLowerCase();
  const user = rawUser.toLowerCase();
  if (!hostPattern.test(host) || !user || user.length > 254 || /[\s\r\n]/.test(user))
    throw Error('INVALID_TAILSCALE_CONFIGURATION');
  return { host, user };
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function validateBookflipRequest(request, access = null) {
  const port = String(request.socket.localPort || 4317);
  const localHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const host = String(request.headers.host || '').toLowerCase();
  const local = localHosts.has(host);
  // Serve injects this identity header and strips client-supplied copies.
  // Funnel does not provide it; reject Funnel even if exposed accidentally.
  const viaServe = Boolean(access && host === access.host &&
    isLoopback(request.socket.remoteAddress) &&
    String(request.headers['tailscale-user-login'] || '').toLowerCase() === access.user);
  if (!local && !viaServe) return { status:403, error:'INVALID_HOST' };
  const origin = request.headers.origin;
  if (origin) {
    let parsed;
    try { parsed = new URL(origin); }
    catch { return { status:403, error:'INVALID_ORIGIN' }; }
    const localOrigin = local && parsed.protocol === 'http:' && localHosts.has(parsed.host.toLowerCase());
    const remoteOrigin = viaServe && parsed.origin === `https://${access.host}`;
    if (!localOrigin && !remoteOrigin)
      return { status:403, error:'INVALID_ORIGIN' };
  }
  if (['POST','PUT','PATCH','DELETE'].includes(request.method)) {
    if (!origin) return { status:403, error:'ORIGIN_REQUIRED' };
    const type = String(request.headers['content-type'] || '')
      .split(';',1)[0].trim().toLowerCase();
    if (type !== 'application/json') return { status:415, error:'JSON_REQUIRED' };
  }
  return null;
}
