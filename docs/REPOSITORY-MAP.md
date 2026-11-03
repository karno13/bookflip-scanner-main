# Mapa repozytorium — aktualny BookFlip

**Kierunek produktu:** [handel książkami, nie zarządzanie prywatną kolekcją](PRODUCT-DIRECTION.md). Katalog, serie i wydania są narzędziami identyfikacji oraz wyceny towaru.

## Aktywna aplikacja

| Warstwa | Pliki |
| --- | --- |
| Uruchamianie | `Uruchom BookFlip Scanner.cmd`, `local-app.mjs` |
| Frontend, 6 zakładek | `app/index.html`, `app/styles.css`, `app/app.js`, `app/views/*.js` |
| Skanowanie | `marketplaces.mjs`, `local-scan.mjs`, `vinted-detail.mjs` |
| SQLite | `catalog-production.mjs`, `sqlite-catalog-repository.mjs`, `catalog-api.mjs`, `offer-sets.mjs` |
| ISBN / metadane | `catalog-resolver.mjs`, `identification-worker.mjs`, `metadata-lookup.mjs`, `metadata-sources/` |
| Trwały katalog danych / backup | `catalog-data-location.mjs`, `scripts/backup-catalog.mjs` |
| Migracje — zachować | `migrations/001_catalog.sql` … `007_offer_sets.sql` |
| Testy Node | `*.test.mjs`, `.github/workflows/scanner-tests.yml` |
| Test startu interfejsu | `scripts/browser-smoke.mjs`, `.github/workflows/browser-smoke.yml` |
| Publiczne demo | Osobna gałąź `gh-pages` — bez produkcyjnego API |

## Elementy historyczne

Nieaktywny runner GitHub (`run.mjs`, `process.mjs`, `continuation.mjs`, `enrich.mjs`, `page-cursor.mjs`) oraz jego dwa testy zostały usunięte. Nie obsługiwał lokalnego BookFlip ani żadnego osiągalnego workflow w tym repozytorium. Zachowano odrębnie testowane narzędzia parsowania kanałów (`feed.mjs`, `rss.mjs`) oraz aktualne moduły skanera.

Narzędzia importu JSON i prób migracji są historyczne, lecz nadal przydatne do analizy dawnych danych. Usunięto stare raporty projektowe, nieaktywną instrukcję GitHub runnera i zrzuty w `artifacts/`. W `docs/archive/` zachowano jedynie dokumentację dawnej migracji JSON ze względu na aktywne odnośniki. Usunięte materiały są nadal dostępne w historii Git.

Workflow `source-connectivity.yml` i `buyback-test.yml` są odrębnymi testami łączności z portalami, a nie właściwym skanowaniem użytkownika.

## Bezpieczne sprzątanie

1. Usuwaj tylko nieużywane komponenty z potwierdzonym brakiem importów w aplikacji, testach i CI.
2. **Nigdy nie usuwaj ani nie modyfikuj historycznych migracji SQL**.
3. Nie publikuj plików SQLite, skanów, danych użytkownika, plików WAL ani tokenów.
4. Każda zmiana wymaga testów Node na Linux/Windows i smoke Chromium.
