import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));

export function availableCatalogMigrations(directory = migrationsDirectory) {
  return readdirSync(directory)
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(directory, name), 'utf8').replace(/\r\n/g, '\n'),
        version = Number(name.match(/^\d+/)[0]);
      const checksum = createHash('sha256').update(sql).digest('hex');
      const legacyCrlfChecksum = createHash('sha256')
        .update(sql.replace(/\n/g, '\r\n'))
        .digest('hex');
      return { version, name, sql, checksum, legacyCrlfChecksum };
    });
}


/**
 * SQLite cannot ALTER a CHECK constraint. Rebuild the decision table once to
 * admit excluded offers, preserving rows, indexes and triggers from the current
 * schema. This runs after versioned SQL migrations and is idempotent.
 */
function allowExcludedReviewDecisions(database) {
  const table = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='review_decisions'",
  ).get();
  if (!table) return;
  const expanded = table.sql.replace(
    /('not_book'\s*,\s*)('requeued')/,
    "$1'excluded',$2",
  );
  if (expanded === table.sql) return;
  const objects = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type IN ('index','trigger') AND tbl_name='review_decisions' AND sql IS NOT NULL ORDER BY type",
  ).all();
  database.exec('PRAGMA foreign_keys=OFF');
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      const createTemp = expanded.replace(
        /^(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)(?:"review_decisions"|`review_decisions`|review_decisions)/i,
        '$1review_decisions_upgrade',
      );
      if (createTemp === expanded) throw Error('REVIEW_DECISIONS_SCHEMA_UNRECOGNIZED');
      database.exec(createTemp);
      database.exec('INSERT INTO review_decisions_upgrade SELECT * FROM review_decisions');
      database.exec('DROP TABLE review_decisions');
      database.exec('ALTER TABLE review_decisions_upgrade RENAME TO review_decisions');
      for (const object of objects) database.exec(object.sql);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.exec('PRAGMA foreign_keys=ON');
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length)
    throw Error('REVIEW_DECISIONS_MIGRATION_FK_FAILED');
}

export function applyCatalogMigrations(
  database,
  { directory = migrationsDirectory, now = () => new Date() } = {},
) {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
 ) STRICT`);
  const applied = new Map(
    database
      .prepare('SELECT version, checksum FROM schema_migrations')
      .all()
      .map((row) => [Number(row.version), row.checksum]),
  );
  const completed = [];
  for (const migration of availableCatalogMigrations(directory)) {
    if (applied.has(migration.version)) {
      if (
        ![migration.checksum, migration.legacyCrlfChecksum].includes(applied.get(migration.version))
      )
        throw Error(`MIGRATION_CHECKSUM_MISMATCH:${migration.version}`);
      continue;
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(?,?,?,?)')
        .run(migration.version, migration.name, migration.checksum, now().toISOString());
      database.exec('COMMIT');
      completed.push(migration.version);
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  }
  allowExcludedReviewDecisions(database);
  return completed;
}
