import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SourceRateLimiter } from '../metadata-http.mjs';
import { lookupISBN, SqliteMetadataCache } from '../metadata-lookup.mjs';
import { createBnAdapter } from '../metadata-sources/bn.mjs';
import { createOpenLibraryAdapter } from '../metadata-sources/open-library.mjs';
import { normalizeISBN } from '../isbn-normalization.mjs';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseArguments(argv) {
  const options = { live: false, database: resolve(projectRoot, 'scan-results', 'bookflip-metadata.sqlite'), fixture: null };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--live') options.live = true;
    else if (argument === '--database') options.database = argv[++index];
    else if (argument === '--fixture') options.fixture = argv[++index];
    else positional.push(argument);
  }
  options.isbn = normalizeISBN(positional[0]);
  return options;
}

async function fixtureFetcher(path) {
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  return async (url) => {
    const response = fixture.responses.find((entry) => String(url).includes(entry.match));
    if (!response) throw new Error(`FIXTURE_RESPONSE_NOT_FOUND: ${url}`);
    return {
      status: response.status,
      url: String(url),
      headers: { get(name) { return response.headers?.[name.toLowerCase()] ?? null; } },
      async json() { return structuredClone(response.body); },
    };
  };
}

function withoutPayload(record) {
  const { payload, ...normalized } = record;
  return normalized;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.isbn) throw new Error('Usage: node scripts/lookup-isbn.mjs <valid ISBN> [--fixture path | --live] [--database path]');

  let fetcher = globalThis.fetch;
  let userAgent = 'BookFlip/2.0 (offline fixture mode)';
  let interval = 1_000;
  if (!options.live) {
    const fixturePath = resolve(options.fixture ?? resolve(projectRoot, 'fixtures', 'metadata', `lookup-${options.isbn}.json`));
    fetcher = await fixtureFetcher(fixturePath);
    interval = 0;
  } else {
    const contact = process.env.BOOKFLIP_OPEN_LIBRARY_CONTACT;
    if (!contact) throw new Error('BOOKFLIP_OPEN_LIBRARY_CONTACT is required in --live mode');
    userAgent = `BookFlip/2.0 (${contact})`;
  }

  const repository = new SqliteCatalogRepository(options.database);
  try {
    const bnAdapter = createBnAdapter({ fetcher, limiter: new SourceRateLimiter({ minIntervalMs: interval }) });
    const openLibraryAdapter = createOpenLibraryAdapter({
      fetcher,
      limiter: new SourceRateLimiter({ minIntervalMs: interval }),
      userAgent,
    });
    const result = await lookupISBN(options.isbn, {
      bnAdapter,
      openLibraryAdapter,
      cache: new SqliteMetadataCache(repository),
      repository,
    });
    console.log(JSON.stringify({
      isbn: result.isbn,
      mode: options.live ? 'live' : 'fixture',
      bn: { status: result.bn.status, cache: result.bn.cache, records: result.bn.records.map(withoutPayload) },
      openLibrary: { status: result.openLibrary.status, cache: result.openLibrary.cache, records: result.openLibrary.records.map(withoutPayload) },
      comparison: result.comparison,
      persistence: result.persistence,
    }, null, 2));
  } finally {
    repository.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
