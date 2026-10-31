import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { importJsonV2Data } from './import-json-v2-to-sqlite.mjs';
import { compareHistoryStores } from './history-parity.mjs';

// Rehearsal NEVER opens the original SQLite file for writing.
// Back up the live SQLite snapshot using SQLite's online backup API, which
// includes committed WAL changes. Import only into that private snapshot.
export async function rehearseHistoryMigration({ jsonPath, sqlitePath, outputDirectory } = {}) {
  if (!jsonPath || !sqlitePath || !outputDirectory)
    throw Error('MIGRATION_REHEARSAL_PATHS_REQUIRED');
  const source = resolve(jsonPath),
    database = resolve(sqlitePath),
    directory = resolve(outputDirectory);
  if (!existsSync(source)) throw Error('MIGRATION_JSON_MISSING');
  if (!existsSync(database)) throw Error('MIGRATION_SQLITE_MISSING');
  if (existsSync(directory)) throw Error('MIGRATION_OUTPUT_ALREADY_EXISTS');
  if (
    [source, database].some(
      (path) =>
        path === directory || path.startsWith(directory + '/') || directory.startsWith(path + '/'),
    )
  )
    throw Error('MIGRATION_UNSAFE_OUTPUT');
  const history = JSON.parse(readFileSync(source, 'utf8'));
  if (history?.version !== 2) throw Error('INVALID_JSON_V2_HISTORY');
  mkdirSync(directory, { recursive: false });
  const jsonCopy = join(directory, 'original-history.json'),
    sqliteCopy = join(directory, 'catalog-rehearsal.sqlite'),
    reportPath = join(directory, 'migration-rehearsal-report.json');
  copyFileSync(source, jsonCopy);
  const original = new DatabaseSync(database, { readOnly: true });
  try {
    await backup(original, sqliteCopy);
  } finally {
    original.close();
  }
  const repository = new SqliteCatalogRepository(sqliteCopy);
  let report;
  try {
    const before = compareHistoryStores(history, repository.database);
    const imported = importJsonV2Data(history, repository, { preserveExistingOffers: true });
    const after = compareHistoryStores(history, repository.database);
    report = {
      format: 'bookflip-migration-rehearsal-v1',
      originalFilesUnchanged: true,
      input: { jsonPath: source, sqlitePath: database },
      snapshot: { jsonPath: jsonCopy, sqlitePath: sqliteCopy },
      before,
      import: imported,
      after,
      // Diagnostic only; data must also pass manual and recovery review.
      blockingDifferences: !after.safeToCutOver || imported.conflicts.count > 0,
      action: 'REVIEW_REPORT_BEFORE_CUTOVER',
    };
  } finally {
    repository.close();
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return { ...report, reportPath };
}
