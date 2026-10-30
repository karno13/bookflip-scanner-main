# Produkcyjne wpięcie katalogu

`local-app.mjs` wykonuje dual-write po każdym udanym skanie:

1. zachowuje dotychczasowy zapis w `scan-results/local-offer-history.json`,
2. zapisuje ofertę, obserwację ceny i dowody ISBN do SQLite,
3. tworzy `identification_job`,
4. uruchamia ograniczoną partię resolvera poza transakcją skanu.

SQLite jest domyślnie zapisywany jako `scan-results/bookflip-catalog.sqlite`. Można zmienić ścieżkę przez `BOOKFLIP_CATALOG_DB`.

Zmienne konfiguracyjne:

- `BOOKFLIP_CATALOG_ENABLED=0` — wyłącza integrację.
- `BOOKFLIP_CATALOG_AUTO_RESOLVE=0` — zapisuje joby, ale nie uruchamia workera po skanie.
- `BOOKFLIP_CATALOG_BATCH=5` — maksymalna liczba jobów po jednym skanie.
- `BOOKFLIP_OPEN_LIBRARY_CONTACT` — kontakt używany w User-Agent Open Library.
- `BOOKFLIP_METADATA_TIMEOUT_MS`, `BOOKFLIP_CATALOG_LEASE_MS`, `BOOKFLIP_CATALOG_RETRY_MS` — timeouty i lease/retry.

Status katalogu jest dostępny pod `GET /api/catalog/status`. Awaria SQLite lub BN/Open Library nie przerywa zapisu JSON ofert; job pozostaje w kolejce albo otrzymuje status retry.

Integracja nie modyfikuje D1 i nie uruchamia workera przy imporcie modułu. Skaner nadal jest wywoływany wyłącznie przez istniejący endpoint aplikacji.
