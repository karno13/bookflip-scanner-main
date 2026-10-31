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

## Bezpieczny raport zgodności (etap PR #27)

Przed przełączeniem skanera na zapis wyłącznie do SQLite uruchom na komputerze, na którym znajdują się **oba** magazyny:

```powershell
npm run check:history
```

Opcjonalnie można podać jawne ścieżki:

```powershell
node scripts/check-history-parity.mjs "C:\\BookFlip\\scan-results\\local-offer-history.json" "C:\\BookFlip\\scan-results\\bookflip-catalog.sqlite"
```

Polecenie odczytuje plik JSON oraz bazę SQLite w trybie **read-only**. Nie importuje danych ani nie zmienia przypisań. Porównuje oferty po źródle i znormalizowanym URL, a następnie wykrywa brakujące rekordy, różnice aktualnych cen, liczników wykryć i niejednoznaczne tożsamości. Raport obejmuje ograniczone próbki identyfikatorów.

Kod wyjścia: `0` — brak blokujących rozbieżności, `1` — rozbieżności, `2` — brak plików albo błąd odczytu. Status `safeToCutOver=true` jest tylko **wstępną kontrolą**: nie potwierdza zgodności historii ISBN, wszystkich decyzji bibliograficznych ani odporności na awarię. Dodatkowe oferty występujące wyłącznie w SQLite mogą być poprawnymi nowszymi zapisami, więc raportuje się je osobno; różnice liczników wykryć również nie są automatycznie naprawiane.

**Nie wykonuj migracji na podstawie samego statusu tego raportu.** Przed właściwym przełączeniem nadal wymagana jest kopia obu magazynów, porównanie historii cen i przypisań oraz test na danych testowych.

## Rozszerzona kontrola punktów cenowych i ręcznych powiązań (PR #28)

Raport `bookflip-history-parity-v2` dodatkowo porównuje **każdy zapisany w JSON punkt ceny** (kwotę oraz znacznik czasu) z punktami oferty w SQLite. Brak któregokolwiek historycznego punktu blokuje `safeToCutOver`; dodatkowe punkty istniejące tylko w SQLite są raportowane osobno, ponieważ mogą pochodzić z nowszych skanów.

Ręczne przypisanie `linkMode='manual'` z JSON wymaga aktywnego powiązania oferty w SQLite do wydania z tym samym `legacy_id` książki. Brak przypisania lub inne wydanie blokują przełączenie. Raport nie modyfikuje zapisanych powiązań ani cen.

To nadal **bramka diagnostyczna**, a nie automatyczna migracja: status nie potwierdza kompletności pozostałych dowodów ISBN, historii decyzji recenzenta ani zgodności wszystkich danych bibliograficznych. Przed docelowym przełączeniem należy wykonać kopię plików i zweryfikować próbkę rzeczywistych danych lokalnych.
