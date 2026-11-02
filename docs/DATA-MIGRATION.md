# BookFlip — dane, kopie i migracje SQLite

## Bieżący stan

SQLite jest jedynym produkcyjnym magazynem ofert, historii cen, katalogu, zadań identyfikacji i zestawów. Przestarzały magazyn historii JSON nie jest wykorzystywany przez `local-app.mjs`.

Domyślna ścieżka Windows: `%LOCALAPPDATA%\BookFlip\data\bookflip-catalog.sqlite`. Na Linuxie odpowiednikiem jest `$XDG_DATA_HOME/BookFlip/data` albo `~/.local/share/BookFlip/data`. Ścieżkę można zmienić poprzez `BOOKFLIP_CATALOG_DB`.

## Świeża instalacja bez importu

Nowa instalacja tworzy **pustą bazę** w katalogu użytkownika. Nie przenosi ani nie usuwa `scan-results/bookflip-catalog.sqlite` ze starej instalacji. Jeżeli chcesz zacząć od nowa, nie musisz usuwać starej bazy — zachowaj ją jako archiwum.

Zamknij poprzednią instancję przed aktualizacją. Kolejne wersje programu mogą być instalowane w innym katalogu, ale będą domyślnie używać **tej samej bazy użytkownika**. Skany nie wymagają ponownego uruchomienia po aktualizacji wersji interfejsu, jeśli baza już zawiera zapisane dane.

## Bezpieczeństwo aktualizacji

Przed zastosowaniem nowych migracji SQL istniejącej bazy program tworzy spójną kopię z użyciem SQLite i sprawdza jej integralność. Niepowodzenie backupu zatrzymuje migrację. Migracje schematu są wersjonowane; **nie modyfikuj usuniętych ani istniejących migracji**, bo bazy zapisują ich sumy kontrolne.

Kopia zapasowa nie jest równoznaczna z automatycznym rollbackiem do starszego schematu. Aby przywrócić starszą wersję, zatrzymaj aplikację i użyj kopii utworzonej przed migracją, na osobnej instalacji. Przechowuj też regularne kopie poza laptopem.

```powershell
npm run backup
npm run backup -- "D:\\Backups\\bookflip.sqlite"
```

## Narzędzia historyczne

`import-json-v2-to-sqlite.mjs`, `migration-rehearsal.mjs`, `scripts/check-history-parity.mjs` i `scripts/rehearse-history-migration.mjs` pozostają dla archiwalnych danych i testów — **nie wykonują się automatycznie** podczas zwykłego uruchamiania. Historyczne tryby zapisu opisano w [archiwum](archive/DATA-MIGRATION-LEGACY.md).

`scan-status.json` i `local-app.log` są zapisywane obok bazy. Nie dodawaj tych plików, danych SQLite ani sekretów do Git.
