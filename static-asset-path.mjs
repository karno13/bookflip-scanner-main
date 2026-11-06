// Serve only known public app-shell files and first-party browser JavaScript modules.
// Paths are resolved relative to app/ and never accept a user-selected directory.
const rootFiles = new Set([
  '/index.html',
  '/styles.css',
  '/workflow.css',
  '/trading.css',
  '/mobile-repair.css',
  '/app.js',
  '/frontend-utils.js',
  '/scan-stream.js',
]);

export function publicAssetPath(pathname) {
  const path = pathname === '/' ? '/index.html' : pathname;
  if (rootFiles.has(path)) return path.slice(1);
  if (/^\/(?:views|core)\/[a-z0-9-]+\.js$/.test(path)) return path.slice(1);
  return null;
}
