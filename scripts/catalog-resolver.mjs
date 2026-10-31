import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CatalogResolver } from '../catalog-resolver.mjs';
import { queueHistoricalReidentification } from '../historical-reidentification.mjs';
import { IdentificationWorker } from '../identification-worker.mjs';
import { SourceRateLimiter } from '../metadata-http.mjs';
import { lookupISBN, SqliteMetadataCache } from '../metadata-lookup.mjs';
import { createBnAdapter } from '../metadata-sources/bn.mjs';
import { createOpenLibraryAdapter } from '../metadata-sources/open-library.mjs';
import { normalizeISBN } from '../isbn-normalization.mjs';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function argumentsFor(argv) {
  const result = {
    command: argv[0],
    positional: [],
    dryRun: false,
    limit: 10,
    database: resolve(projectRoot, 'scan-results', 'bookflip-resolver.sqlite'),
    fixture: null,
    title: null,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') result.dryRun = true;
    else if (value === '--database') result.database = argv[++index];
    else if (value === '--fixture') result.fixture = argv[++index];
    else if (value === '--limit') result.limit = Number(argv[++index]);
    else if (value === '--title') result.title = argv[++index];
    else result.positional.push(value);
  }
  return result;
}

async function fixtureFetcher(path) {
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  return async (url) => {
    const response = fixture.responses.find((entry) => String(url).includes(entry.match));
    if (!response)
      return {
        status: 404,
        url: String(url),
        headers: {
          get() {
            return null;
          },
        },
        async json() {
          return {};
        },
      };
    return {
      status: response.status,
      url: String(url),
      headers: {
        get(name) {
          return response.headers?.[name.toLowerCase()] ?? null;
        },
      },
      async json() {
        return structuredClone(response.body);
      },
    };
  };
}

async function resolverFor(repository, options, isbnHint = '9780306406157') {
  const fixturePath = resolve(
    options.fixture ?? resolve(projectRoot, 'fixtures', 'metadata', `lookup-${isbnHint}.json`),
  );
  const fetcher = await fixtureFetcher(fixturePath);
  const bnAdapter = createBnAdapter({
    fetcher,
    limiter: new SourceRateLimiter({ minIntervalMs: 0 }),
  });
  const openLibraryAdapter = createOpenLibraryAdapter({
    fetcher,
    limiter: new SourceRateLimiter({ minIntervalMs: 0 }),
    userAgent: 'BookFlip/2.0 (offline resolver fixture)',
  });
  const cache = options.dryRun ? null : new SqliteMetadataCache(repository);
  return new CatalogResolver({
    repository,
    lookupMetadata: (isbn) => lookupISBN(isbn, { bnAdapter, openLibraryAdapter, cache }),
  });
}

async function main() {
  const options = argumentsFor(process.argv.slice(2));
  if (
    !['resolve-isbn', 'identify-offer', 'process-jobs', 'history-dry-run'].includes(options.command)
  ) {
    throw new Error(
      'Usage: catalog-resolver.mjs resolve-isbn <ISBN> | identify-offer <offer-id> | process-jobs | history-dry-run',
    );
  }
  const repository = new SqliteCatalogRepository(options.database);
  try {
    if (options.command === 'history-dry-run') {
      console.log(
        JSON.stringify(
          queueHistoricalReidentification(repository, { limit: options.limit, dryRun: true }),
          null,
          2,
        ),
      );
      return;
    }
    const isbn = options.command === 'resolve-isbn' ? normalizeISBN(options.positional[0]) : null;
    if (options.command === 'resolve-isbn' && !isbn) throw new Error('A valid ISBN is required');
    const resolver = await resolverFor(repository, options, isbn ?? '9780306406157');
    if (options.command === 'resolve-isbn') {
      const evidence = {
        status: 'valid',
        values: [isbn],
        isbn,
        candidateIsbn: isbn,
        classification: 'structured',
        autoAssignable: true,
        observations: [{ value: isbn, classification: 'structured', source: 'cli', valid: true }],
      };
      const offer = options.title ? { title: options.title, isbn } : null;
      console.log(
        JSON.stringify(
          await resolver.resolve({ offer, evidence, dryRun: options.dryRun }),
          null,
          2,
        ),
      );
    } else if (options.command === 'identify-offer') {
      if (!options.positional[0]) throw new Error('offer-id is required');
      console.log(
        JSON.stringify(
          await resolver.resolve({ offerId: options.positional[0], dryRun: options.dryRun }),
          null,
          2,
        ),
      );
    } else {
      const worker = new IdentificationWorker({ repository, resolver });
      console.log(JSON.stringify(await worker.processBatch(options.limit), null, 2));
    }
  } finally {
    repository.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
