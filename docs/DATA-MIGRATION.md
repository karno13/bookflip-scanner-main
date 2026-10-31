# BookFlip: przejście z JSON v2 do SQLite

## Stan obecny

SQLite jest głównym magazynem katalogu, wydań, ofert, decyzji ISBN i historii cen udostępnianych w widokach katalogu. Starszy plik `scan-results/local-offer-history.json` nadal obsługuje kompatybilność skanera oraz dawne operacje ręczne. **To nie jest jeszcze pełne przejście na jedną bazę.**

### Kierunek i ochrona danych

- Skan zapisuje historię JSON, a następnie przekazuje zaobserwowane oferty do SQLite.
- Ręczne dodanie książki i przypisanie oferty do katalogu JSON nie powinno ponownie odtwarzać całego archiwum w SQLite. Zmiana w PR #26 ogranicza import do wskazanej książki/oferty.
- W tej ścieżce już zapisane w SQLite ceny, licznik wykryć, tytuły oraz aktywne przypisania pochodzące z innych źródeł niż import JSON pozostają nadrzędne.
- Jawny import pełnego JSON v2 przez narzędzie `import-json-v2-to-sqlite.mjs` pozostaje dostępny na potrzeby migracji historycznej i kopii danych; nie należy uruchamiać go bez kopii bazy.
- Ceny ofert są obserwacjami, nie dowodami sprzedaży.

## Docelowa migracja

1. Wykonać kopię zarówno JSON, jak i pliku SQLite oraz sprawdzić ich odczyt.
2. Przygotować raport różnic liczby ofert, identyfikatorów źródeł, przypisań ręcznych, ISBN i chronologii cen (bez automatycznego scalania konfliktów).
3. Zaimplementować zapis skanu wyłącznie do SQLite w jednej transakcji, zachowując opcjonalny eksport JSON wstecznej kompatybilności.
4. Zmienić `/api/history` i historyczne akcje ręczne na odczyt/zapis z SQLite.
5. Przetestować migrację na kopii danych użytkownika, w tym przerwanie procesu i ponowne uruchomienie.
6. Dopiero po weryfikacji usunąć dwukierunkowe synchronizowanie i pozostawić JSON jako format eksportu.

**Nie usuwać ani nie zerować pliku JSON lub SQLite automatycznie.** W razie konfliktu danych z różnych źródeł zachować oryginały, oznaczyć niepewność i wymagać decyzji użytkownika.
