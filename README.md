# BookFlip — lokalny skaner i katalog książek

BookFlip to lokalna aplikacja na Windows z interfejsem w przeglądarce, skanowaniem ofert i katalogiem SQLite. Główny serwer to `local-app.mjs`. **GitHub Pages jest tylko demonstracją**, nie uruchamia skanów ani nie przechowuje Twojego katalogu.

## Uruchomienie (Windows 11)

1. Zainstaluj Node.js **24 lub nowszy**.
2. Pobierz aktualne repozytorium i rozpakuj je w osobnym folderze aplikacji.
3. Uruchom **`Uruchom BookFlip Scanner.cmd`** (lub `npm start`).
4. Otwórz `http://127.0.0.1:4317`.

Pozostaw serwer uruchomiony, gdy skanujesz lub identyfikujesz książki. Aplikacja domyślnie nasłuchuje **wyłącznie na localhost**; nie udostępniaj portu 4317 bez osobnego, przetestowanego rozwiązania uwierzytelnienia i sieci prywatnej.

## Sześć obszarów aplikacji

| Zakładka | Funkcja |
| --- | --- |
| Skaner | Wybór źródeł, zapytania, przebieg skanu i oferty |
| Do weryfikacji | Decyzje dotyczące ISBN i wydania, oznaczanie oferty jako zestawu |
| Katalog | Dzieła i wydania, identyfikatory, metadane |
| Zestawy | Jedna oferta z kilkoma wydaniami; cena dotyczy całego zestawu |
| Oferty | Filtry, historia cen i szczegóły zapisanych ogłoszeń |
| Ustawienia | Stan SQLite, diagnostyka identyfikacji, ręczne ponowienie kolejki |

Znajdowanie ISBN w źródłach zewnętrznych nie gwarantuje automatycznego przypisania. Sprzeczne lub słabe dowody nadal kierują ofertę do ręcznej weryfikacji.

## Gdzie są dane?

**Nowa instalacja niczego nie importuje ze starego katalogu programu.**

- Windows: `%LOCALAPPDATA%\BookFlip\data\bookflip-catalog.sqlite`
- Linux: `$XDG_DATA_HOME/BookFlip/data/bookflip-catalog.sqlite` lub `~/.local/share/BookFlip/data/bookflip-catalog.sqlite`
- Plik stanu: `scan-status.json`, a log diagnostyczny: `local-app.log` — w tym samym katalogu danych.
- Zmienna `BOOKFLIP_CATALOG_DB` pozwala świadomie wskazać inną bazę.
- Stary `scan-results/` pozostaje nieużywany przez nowy domyślny magazyn SQLite; jego usunięcie nie jest wymagane i może pozbawić Cię archiwum.

**Aktualizacja:** zamknij BookFlip, wymień tylko pliki programu i uruchom ponownie. Nie usuwaj katalogu `%LOCALAPPDATA%\BookFlip\data`. Przed zmianami struktury istniejącej bazy program wykonuje kopię w podfolderze `backups`. Przed większą aktualizacją zalecana jest dodatkowa kopia na inny dysk.

### Ręczny backup

```powershell
npm run backup
npm run backup -- "D:\\Backups\\bookflip.sqlite"
```

Backup używa API SQLite (uwzględnia WAL), sprawdza integralność i nie nadpisuje istniejącej kopii. Kopia zapasowa na tym samym dysku nie chroni przed awarią dysku.

## Testowanie

```powershell
npm test
npm run lint
npm run check:syntax
```

CI: `.github/workflows/scanner-tests.yml` (testy Node na Linux i Windows) oraz `.github/workflows/browser-smoke.yml` (Chromium, sześć widoków, izolowana niepusta baza testowa). Test przeglądarkowy nie zastępuje pełnego testu skanowania rzeczywistych portali.

## Architektura i dalsza dokumentacja

- `local-app.mjs` — serwer i API; `app/` — interfejs.
- `marketplaces.mjs`, `local-scan.mjs` — źródła skanowania.
- `catalog-production.mjs`, `sqlite-catalog-repository.mjs`, `catalog-api.mjs`, `offer-sets.mjs` — zapis i odczyt katalogu oraz zestawów.
- `catalog-resolver.mjs`, `identification-worker.mjs`, `metadata-sources/` — dopasowanie ISBN i metadane.
- `migrations/` — **niezmienne** migracje SQLite; nie usuwaj starych plików migracji.

Szczegóły: [Katalog i konfiguracja](PRODUCTION-CATALOG.md), [Przechowywanie i migracje](docs/DATA-MIGRATION.md), [Mapa repozytorium](docs/REPOSITORY-MAP.md).

## Co jest historyczne?

Repozytorium nadal zawiera moduły dawnego runnera GitHub oraz narzędzia importu starej historii JSON. Nie są głównym sposobem uruchamiania BookFlip, ale część ma nadal własne testy i zastosowania diagnostyczne. Nie usuwamy ich bez potwierdzenia braku zależności. Archiwalne materiały znajdują się w `docs/archive/`.

Nie commituj prawdziwych baz SQLite, historii skanów, cookies, kluczy ani innych danych prywatnych.
