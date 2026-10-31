import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

const [databasePath, workId, isbn, title] = process.argv.slice(2),
  repository = new SqliteCatalogRepository(databasePath, { busyTimeout: 10000 });
try {
  const edition = repository.createEditionForISBN({
    workId,
    isbn,
    title,
    source: 'concurrency_test',
  });
  process.stdout.write(edition.id);
} finally {
  repository.close();
}
