# Mapa repozytorium — BookFlip

## Aktualny produkt lokalny

| Obszar | Pliki | Stan |
| --- | --- | --- |
| Uruchamianie Windows | `Uruchom BookFlip Scanner.cmd`, `local-app.mjs` | Główna ścieżka użytkownika |
| UI | `app/index.html`, `app/app.js`, `app/styles.css` | Główny frontend |
| Źródła | `marketplaces.mjs`, `local-scan.mjs`, `vinted-detail.mjs` | Aktywne adaptery |
| Katalog | `catalog-production.mjs`, `catalog-api.mjs`, `sqlite-catalog-repository.mjs` | Lokalny SQLite |
| Metadane | `metadata-sources/`, `metadata-lookup.mjs`, `catalog-resolver.mjs` | BN / Open Library i rozpoznawanie |
| Historia i cena | `offer-history.mjs`, `price-analysis.mjs` | Dane ofertowe, nie sprzedaż |
| Testy | `*.test.mjs`, `.github/workflows/scanner-tests.yml` | Offline CI |
| Publiczne demo | gałąź `gh-pages` | Tylko przykładowe dane |

## Moduły starszego sposobu działania

`run.mjs`, `continuation.mjs`, `process.mjs`, `enrich.mjs`, `feed.mjs`, `rss.mjs`, `historical-reidentification.mjs`, `local-batch-scan.mjs` oraz część testów dotyczą starszego modelu kolejki/automatyzacji. **Nie są usuwane**, ponieważ nie ma jeszcze audytu zależności oraz końcowego testu uruchamiania na Windows. Status historyczny nie oznacza bezużyteczności.

Workflow `.github/workflows/bookflip-scan.yml` posiada warunek identyfikujący inne repozytorium (`PJASDEM/bookflip-scanner`), więc jego zadania nie powinny wykonywać skanowania w `karno13/bookflip-scanner-main`. Wymaga osobnej decyzji o wyłączeniu harmonogramów; nie zmieniamy go w ciemno.

`.github/workflows/buyback-test.yml` i `source-connectivity.yml` to testy łączności zewnętrznej, odrębne od testów offline. Nie należy traktować ich wyników jak lokalnych testów pełnego procesu.

## Dokumentacja historyczna

- `docs/archive/README-legacy-github-runner.md`: dawny główny README opisujący GitHub Actions / Sites.
- `AUDIT-2026-10-25.md`, `AUDIT-POST-PR5.md`: dawne audyty z określonego momentu rozwoju.
- `FRONTEND-REDESIGN.md`, `design-qa.md`: poprzednie przeglądy projektu, nie stan obecnej implementacji.
- `artifacts/`: archiwalne zrzuty i ślady poprzednich audytów.

## Zasady dalszego porządkowania

1. Kod można usunąć dopiero po potwierdzeniu, że nie importuje go `local-app.mjs`, katalog, testy ani aktywny workflow.
2. Historyczne raporty można w kolejnym PR przenieść do `docs/archive/` bez utraty treści.
3. Żadnych prawdziwych danych użytkownika, historii skanów, sekretów ani baz SQLite w repozytorium.
4. Aktualny `main` pozostaje punktem wyjścia; zmiany wprowadzaj na osobnych gałęziach z testami.
