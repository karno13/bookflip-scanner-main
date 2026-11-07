# Changelog

BookFlip uses small pull requests and GitHub Actions on Ubuntu/Windows to track changes.

## 2026-11-07 — Skaner, katalog i weryfikacja

- **BN: wszystkie formy ISBN.** Adapter pytał tylko o dokładną formę numeru, więc książki indeksowane w BN pod ISBN-10 uchodziły za nieznane. Teraz sprawdzane są obie formy. Migracja 105 usuwa stare negatywne odpowiedzi z cache i ponownie kolejkuje oferty zamknięte jako „nie znaleziono”.
- **ISBN nieznany źródłom nie znika z kolejki.** Wynik `not_found` zostawia zadanie w weryfikacji (z istniejącym przepływem „Dodaj do katalogu”), zamiast zamykać je poza katalogiem i kolejką.
- **Strony szczegółów (Tezeusz.pl).** ISBN, wydawca, autor i rok są czytane z danych strukturalnych produktu (JSON-LD, atrybuty). Treści opisów, adresów obrazków i „polecanych ofert” nie czytamy — na Allegro Lokalnie zawierają ISBN-y innych książek. Migracja 106.
- **Propozycje po tytule** dla ofert bez ISBN (BN, ocena zgodności z tomem, autorem, językiem i rodzajem dokumentu). Tylko podpowiedź — przypisanie wymaga potwierdzenia. Migracja 107. W kolejce: znacznik pewności, sortowanie „Najpewniejsze propozycje”, skróty Alt+Enter i Alt+1…5.
- **Dodruki w jednym dziele.** BN nie podaje identyfikatora dzieła, więc każde ISBN tworzyło osobne dzieło. Nowe wydanie o tym samym tytule i pierwszym autorze trafia do istniejącego dzieła. Panel „Możliwe duplikaty dzieł” w Katalogu łączy istniejące grupy.
- **Poprawki błędów:** łączenie dzieł kończyło się błędem 500 przy dziełach z rekordami zewnętrznymi (tabela jest niezmienna); bramka tempa źródeł przekazywała `signal: null` do timera i padała na drugim żądaniu bez sygnału przerwania.
- **Skaner:** automatyczny skan wybranego profilu co N godzin (domyślnie wyłączony), skuteczność zapytań (oferty / w katalogu / czeka / bez ISBN), ceny-śmieci (≥ 10 000 zł) zapisywane jako nieznane, log bez wpisów przy braku pracy.
- **Porządek:** archiwalne raporty przeniesione do `docs/archive`, usunięte kopie starych arkuszy CSS, zrzuty i logi testów; usunięto 25 reguł CSS, które niczego nie zmieniały; historia Git od tego punktu.

## 2026-11-04 — Reliability fixes from project audit

- Identification drains ready batches continuously (default 25 jobs) instead of waiting for the next poll between small batches. Pause, stop and provider request limits remain respected.
- Concurrent ISBN lookups share requests; Open Library work and author resources use a bounded one-hour memory cache. Manual-review tasks no longer appear as unfinished automatic work in progress indicators.
- Added offline queue-throughput, request-coalescing, resource-cache and progress regressions plus a synthetic identification benchmark.

- Reworked all six workspaces around sourcing, explicit edition review and purchase decisions. Scan membership, saved scenarios, actual purchase prices, bundle quantities and unknown members use migration 104.
- Added full-dataset purchase filters and single offer pagination, a shared accessible details drawer, five primary mobile destinations with a More menu, and unsaved-form protection.
- Added work/edition metadata editing, previewed work merges, review corrections preserving immutable history, source health and verified backups from Settings.
- Updated offline integration tests and the browser smoke workflow for the new interactions.

- Restore transaction nesting after failed COMMIT and version the excluded-review schema upgrade as migration 103, with backup and integrity checks before commit.
- Normalize Polish Unicode consistently in catalog, author, offer and review searches; preserve UTF-8 characters across HTTP request chunks.
- Isolate each test process's runtime files and enforce a 30-second test timeout through `npm test`; include JavaScript tests and tooling changes in CI triggers.
- Compute book statistics in batches, reduce historical prices in SQL for legacy snapshots, scope manual book projection and group scan identifiers once per edition.
- Add a matched-edition scan benchmark and ignore SQLite databases in Git. Existing migration SQL files remain unchanged.

## 2026-10-31 — SQLite-first catalogue

- Retired the obsolete JSON scan mirror/outbox recovery modules after the SQLite-only HTTP cutover (PR #50). Historical SQLite migration files remain immutable.

- SQLite became the default store for offers, prices, manual catalogue actions and ISBN identification (PR #36).
- Added background identification polling and retry after restart (PR #37).
- Added offline end-to-end scanner and HTTP persistence regressions (PR #38 and #40).
- Prevented overlapping local scans and tightened book-product filtering (PR #41).
- Fixed literal catalogue searches, retry handling and migration documentation (PR #41–42).
- Replaced the 10,000-record startup limit with incremental loading (PR #43).
- Added cross-platform syntax checks and editor defaults (PR #44).
- Extended SQLite-backed global searching and bounded large-list DOM rendering (PR #45–46).

**Runtime:** After PR #49 the local HTTP server is SQLite-only; historical JSON import/parity CLI tools remain available. No automatic data deletion or import is performed.

**Known limitations:** marketplace parsers still need sanitized, confirmed real-world page fixtures; historical JSON import and migration test code remains archived in the repository; page filters and sorting beyond the server-side text query need complete backend pagination coverage.
