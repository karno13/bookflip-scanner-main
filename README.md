# BookFlip — lokalny skaner i katalog książek

BookFlip to lokalna aplikacja na Windows z interfejsem przeglądarkowym, skanerem ofert i bibliograficznym katalogiem SQLite. **Aktualnym sposobem uruchamiania jest `local-app.mjs`, a nie historyczna kolejka GitHub Actions.**

## Szybki start na Windows

1. Zainstaluj Node.js 24 (wersja używana przez CI).
2. Pobierz całe repozytorium i rozpakuj je w jednym folderze.
3. Uruchom dwuklikiem **`Uruchom BookFlip Scanner.cmd`** albo wykonaj `node local-app.mjs`.
4. Otwórz **http://127.0.0.1:4317**. Nie trzeba publikować serwera w internecie.

Plik CMD wykrywa już działający lokalny serwer i otwiera go w przeglądarce. W razie problemów sprawdź terminal i `scan-results/local-app.log`.

## Pięć obszarów aplikacji

| Obszar | Do czego służy |
| --- | --- |
| Skaner | Frazy, wybór źródeł, postęp oraz wyszukiwanie zapisanych ofert |
| Do weryfikacji | Oferta, dowody ISBN, propozycja wydania i świadoma decyzja |
| Katalog | Dzieła, wydania, metadane, ISBN i powiązane oferty |
| Oferty | Wyszukiwanie, filtry, szczegóły, historia cen i kalkulator scenariusza |
| Ustawienia | Status SQLite, źródła i diagnostyka |

Aplikacja pobiera dostępne źródła z backendu; nie wszystkie adaptery są zawsze dostępne i nie każdy portal pozwala na niezawodny odczyt.

## Dane i prywatność

- `scan-results/local-offer-history.json`: lokalna historia ofert / kompatybilność starszych danych.
- `scan-results/bookflip-catalog.sqlite`: lokalny katalog SQLite (domyślna ścieżka).
- `scan-results/local-app.log`: lokalny dziennik diagnostyczny.
- Folder `scan-results/` i pliki SQLite WAL są ignorowane przez Git. **Nie dodawaj prawdziwych baz, historii skanów, ciasteczek ani sekretów do repozytorium**.
- Okładki Open Library to zewnętrzne obrazy podpowiadane wyłącznie po ISBN o poprawnej sumie kontrolnej. Brak okładki oznacza placeholder; zdjęcia nie są kopiowane do SQLite.

Historia cen zawiera zaobserwowane **ceny ogłoszeń**, nie ceny zakończonych transakcji. Kalkulator odsprzedaży działa na ręcznie przyjętych kosztach i cenie sprzedaży; nie jest gwarancją zysku.

## Testy

```powershell
node --test
```

Takie same testy offline uruchamia `.github/workflows/scanner-tests.yml` na Node.js 24. Nie zastępują testów prawdziwego skanowania i pełnego przebiegu na Windows.

## Architektura

- `app/index.html`, `app/styles.css`, `app/app.js` — pięć obszarów interfejsu.
- `local-app.mjs` — lokalny HTTP API, skanowanie i integracja danych.
- `marketplaces.mjs`, `local-scan.mjs`, `vinted-detail.mjs` — adaptery źródeł.
- `catalog-production.mjs`, `catalog-api.mjs`, `sqlite-catalog-repository.mjs` — katalog, odczyty i zapisy SQLite.
- `catalog-resolver.mjs`, `identification-worker.mjs`, `metadata-sources/` — identyfikacja i zewnętrzne metadane.
- `offer-history.mjs`, `price-analysis.mjs` — historia ofert i analiza cen.
- `migrations/` — migracje schematu SQLite.

Więcej szczegółów konfiguracji katalogu: [PRODUCTION-CATALOG.md](PRODUCTION-CATALOG.md).

## GitHub Pages — tylko demonstracja

Publiczny podgląd [BookFlip](https://karno13.github.io/bookflip-scanner-main/) jest odrębną aplikacją statyczną z przykładowymi danymi, na gałęzi `gh-pages`. **Nie uruchamia prawdziwych skanów, SQLite ani zapisywania decyzji.** Zmiany produkcyjnego interfejsu nie pojawiają się automatycznie w demonstracji, dopóki nie zostanie zaktualizowana.

## Kod historyczny

Repozytorium zawiera także starszy skaner/runner kolejki GitHub Actions, używany wcześniej dla innego sposobu pracy. Kod historyczny nie jest podstawowym punktem wejścia do lokalnego BookFlip. Nie usuwamy go automatycznie, bo część testów i narzędzi nadal może z niego korzystać.

- [Archiwalny README runnera](docs/archive/README-legacy-github-runner.md)
- [Mapa aktywnych i historycznych elementów](docs/REPOSITORY-MAP.md)
- [Raport starego frontendu](FRONTEND-REDESIGN.md) oraz archiwalne audyty — tylko jako dokumentacja historyczna.

## Gotowość do wydania

CI obejmuje testy offline, ale przed uznaniem aplikacji za gotową wymagany jest jeszcze test na Windows: uruchomienie przez CMD, skan wybranego źródła, zapis oferty i SQLite, identyfikacja wydania, zapis decyzji i odczyt analizy cen.
