import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Preloaded before application imports in each test process. Never use the
// user's live catalog, log or scan-status files, including with :memory: mocks.
const directory = mkdtempSync(join(tmpdir(), 'bookflip-test-runtime-'));
process.env.BOOKFLIP_CATALOG_DB = join(directory, 'catalog.sqlite');
process.once('exit', () => {
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
});
