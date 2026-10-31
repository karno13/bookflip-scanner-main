import { pathToFileURL } from 'node:url';
import { scanMarketplace } from './marketplaces.mjs';

export const localSourceHosts = {
  Allegro: 'allegro.pl',
  Empik: 'www.empik.com',
  Vinted: 'www.vinted.pl',
  'Allegro Lokalnie': 'allegrolokalnie.pl',
  OLX: 'www.olx.pl',
  'Tezeusz.pl': 'tezeusz.pl',
  'Dedalus.pl': 'dedalus.pl',
};
const sourceHosts = localSourceHosts;
const sourceNames = new Map(Object.keys(sourceHosts).map((name) => [name.toLowerCase(), name]));

export function parseLocalArgs(argv) {
  const values = { source: 'Empik', query: 'Warcraft', page: 1, examples: 5 };
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (option === '--help' || option === '-h') return { ...values, help: true };
    if (!['--source', '--query', '--page', '--examples'].includes(option))
      throw Error('UNKNOWN_OPTION: ' + option);
    const value = argv[++index];
    if (value == null || value === '') throw Error('MISSING_OPTION_VALUE: ' + option);
    if (option === '--source') values.source = value;
    else if (option === '--query') values.query = value.trim();
    else values[option.slice(2)] = Number(value);
  }
  if (!values.query) throw Error('EMPTY_QUERY');
  if (!Number.isInteger(values.page) || values.page < 1 || values.page > 10000)
    throw Error('INVALID_PAGE');
  if (!Number.isInteger(values.examples) || values.examples < 0 || values.examples > 20)
    throw Error('INVALID_EXAMPLES');
  const requested =
    values.source.toLowerCase() === 'all'
      ? [...sourceNames.values()]
      : [sourceNames.get(values.source.toLowerCase())];
  if (requested.some((name) => !name)) throw Error('UNKNOWN_SOURCE: ' + values.source);
  return { ...values, sources: requested };
}

export async function runLocalScan(
  config,
  { scanner = scanMarketplace, write = (line) => console.log(line) } = {},
) {
  let failed = 0;
  for (const source of config.sources) {
    const task = {
      source,
      host: sourceHosts[source],
      mode: 'discovery',
      title: config.query,
      category: config.query,
      language: 'pl',
      searchQuery: config.query,
      page: config.page,
      paginationVersion: 1,
    };
    try {
      const result = await scanner(task);
      write(
        JSON.stringify(
          {
            source,
            result: 'read',
            query: config.query,
            page: config.page,
            offers: result.offers.length,
            pagination: result.pagination,
            examples: result.offers
              .slice(0, config.examples)
              .map(({ title, price, url }) => ({ title, price, url })),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      failed++;
      write(
        JSON.stringify(
          {
            source,
            result: 'unavailable',
            query: config.query,
            page: config.page,
            code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'SOURCE_REQUEST_FAILED',
            status: Number.isInteger(error.status) ? error.status : null,
            blocked: error.blocked === true,
            retryable: error.retryable === true,
            retryAfter: error.retryAfter ?? null,
          },
          null,
          2,
        ),
      );
    }
  }
  return { failed, total: config.sources.length };
}

async function main() {
  const config = parseLocalArgs(process.argv.slice(2));
  if (config.help) {
    console.log(
      'Użycie: node local-scan.mjs [--source nazwa|all] [--query tekst] [--page numer] [--examples 0-20]',
    );
    console.log('Źródła: ' + Object.keys(sourceHosts).join(', '));
    return;
  }
  const result = await runLocalScan(config);
  if (result.failed) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(JSON.stringify({ result: 'invalid_arguments', error: error.message }));
    process.exitCode = 1;
  });
