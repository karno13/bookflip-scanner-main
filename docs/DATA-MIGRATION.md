# BookFlip — SQLite jako jedyny magazyn aplikacji

Od wersji katalogu po PR #49 lokalny serwer BookFlip korzysta wyłącznie z SQLite. `npm start` uruchamia skanowanie, odczyt historii, ceny, tworzenie książek i ręczne przypisywanie ofert w bazie `scan-results/bookflip-catalog.sqlite`.

**Tryb `BOOKFLIP_STORAGE=json` został wycofany z lokalnego serwera.** Ustawienie inne niż `sqlite` zgłasza błąd zamiast po cichu zapisywać dane gdzie indziej. Flagi historyczne `BOOKFLIP_SQLITE_FIRST`, `BOOKFLIP_SQLITE_HISTORY_READ` i `BOOKFLIP_SQLITE_MANUAL_WRITE` nie zmieniają już bieżącego zachowania serwera.

## Nowa instalacja

1. Użyj Node.js 24 lub nowszego i uruchom `npm start`.
2. Katalog SQLite powstaje automatycznie w `scan-results/`. Nie usuwaj pliku bazy ani jej kopii zapasowych.
3. Historia cen przechowywana jest w `offer_price_history`, a podsumowania skanów w `scan_runs`. Zadania ISBN pozostają w `identification_jobs`.
4. Nie uruchamiaj równocześnie kilku instancji na tym samym pliku bazy. Serwer zwraca HTTP 409 przy próbie równoległego skanu w obrębie jednej instancji.

## Stare pliki JSON

Historyczne narzędzia importu i kontroli danych pozostają w repozytorium, **nie są używane przez działający serwer**. Dla odzyskanych starych plików można wykonać:

```powershell
npm run check:history
npm run rehearse:history -- --json "ścieżka-do-historii.json" --sqlite "ścieżka-do-bazy.sqlite" --output "nowy-folder-proby"
```

Próba migracji zapisuje kopie i raport do nowego, nieistniejącego katalogu. Nie modyfikuje oryginalnych danych. Przed importem rzeczywistych rekordów sprawdź raport oraz zrób kopie bazy.

Historyczny opis migracji i wygaszonych trybów znajduje się w [archiwum](archive/DATA-MIGRATION-LEGACY.md).

## Stan techniczny

SQLite jest magazynem zapisu i odczytu, także dla `/api/history` i `/api/book`. Interfejs pobiera dane stronicowo. Tekstowe wyszukiwanie i filtry/sortowanie katalogu wykonują zapytania do SQLite. Narzędzia JSON, testy migracyjne i starsze tabele outbox pozostają w kodzie jedynie do celów historycznych i diagnostycznych; nie należy usuwać istniejących migracji SQL z łańcucha migracyjnego.
