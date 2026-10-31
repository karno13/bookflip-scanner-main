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
  return completed;
}
