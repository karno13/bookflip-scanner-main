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

## Eksperymentalny zapis skanu: SQLite przed JSON

Wprowadzono przełącznik środowiskowy `BOOKFLIP_SQLITE_FIRST=1`. Bez niego obowiązuje zachowanie zgodności ze starszą wersją. Po ustawieniu przełącznika skan zapisuje rekordy najpierw w transakcyjnym katalogu SQLite, a następnie aktualizuje starszą historię JSON używaną przez część widoków.

**Nie jest to jeszcze SQLite-only.** Awaria zapisu SQLite zatrzymuje operację przed aktualizacją JSON; awaria zapisu JSON po udanym zapisie SQLite pozostawia rozbieżność pomiędzy magazynami i jest zgłaszana jako błąd (bez ukrywania jej jako sukces). Nie należy automatycznie ponawiać nieudanego skanu, zanim nie sprawdzi się obu magazynów — ponowienie może zwiększyć licznik wykryć.

Przełącznik pozostaje domyślnie wyłączony do czasu testów odzyskiwania, przełączenia odczytów oraz strategii odtwarzania niespójnych zapisów. Dla niezawodnej migracji wymagana jest transakcyjna ścieżka tylko w SQLite, nie stały podwójny zapis.

## Odczyt historii bezpośrednio z SQLite (eksperymentalny)

Flaga `BOOKFLIP_SQLITE_HISTORY_READ=1` pozwala pobierać `/api/history` i `/api/book` z SQLite poprzez adapter zgodności, bez modyfikacji bazy. Domyślnie pozostaje odczyt JSON.

W tym trybie odczytywane są oferty, bieżące ceny, obserwacje cen i **aktywne** przypisania do wydań. Przypisania nieweryfikowane nie są automatycznie uznawane za aktywne. Dane o skanach i cache szczegółów przechowywane wyłącznie w JSON nie są odtwarzane przez ten adapter; w odpowiedzi `lastScan` jest `null`. Przed przełączeniem produkcyjnym wymagane są testy zgodności na kopii rzeczywistych danych oraz migracja metadanych skanów.

Przełącznika odczytu nie należy traktować jako finalnego wycofania JSON. W razie braku katalogu SQLite aktywny tryb zgłasza błąd zamiast prezentować nieaktualne informacje.

## Odzyskiwanie JSON po przerwanym zapisie SQLite-first

W trybie `BOOKFLIP_SQLITE_FIRST=1` skan zapisuje w SQLite, w **tej samej transakcji** co nowe oferty, rekord `scan_json_mirror_outbox` zawierający stan kopii JSON. Dopiero potem aktualizuje plik JSON i oznacza rekord jako zakończony. Przed następnym skanem w tym trybie aplikacja próbuje odtworzyć oczekujące zapisy JSON bez ponownego zapisywania ofert SQLite (ani ponownego naliczania `seen_count`).

Gdy plik JSON ma datę modyfikacji **nowszą** od oczekującej kopii, odzyskiwanie przerywa się błędem `JSON_MIRROR_RECOVERY_CONFLICT` i nie zastępuje nowszych danych. Konflikt jest utrwalony do ręcznej analizy w SQLite. Należy wtedy wykonać kopię obu magazynów i zbadać raport zgodności `npm run check:history`, zamiast usuwać rekord lub wymuszać nadpisanie.

Mechanizm nie jest transakcją obejmującą dwa pliki. Nie chroni przed uszkodzeniem dysku, niezależną edycją JSON pomiędzy zapisami lub niezgodnością całych danych bibliograficznych. Nadal nie należy kasować JSON ani włączać tego trybu bez aktualnej kopii zapasowej.

## Opcjonalne zapisy ręczne do SQLite przed JSON

Zmienne `BOOKFLIP_SQLITE_MANUAL_WRITE=1` i `BOOKFLIP_SQLITE_HISTORY_READ=1` umożliwiają przetestowanie ręcznego dodania książki i przypisania oferty z zachowaniem SQLite jako głównego zapisu. Tryb jest **domyślnie wyłączony**. Dla spójnej próby zalecane jest również `BOOKFLIP_SQLITE_FIRST=1`, po wykonaniu kopii bazy oraz pliku JSON i sprawdzeniu raportu `npm run check:history`.

Nowe operacje w trybie SQLite-first zapisują zmianę bibliograficzną i snapshot JSON w jednej transakcji SQLite; JSON stanowi kopię zgodności z istniejącymi ekranami. Przed operacją są odtwarzane niedokończone kopie JSON. Przy błędzie zapisu JSON kopia pozostaje oznaczona jako oczekująca i może być odzyskana bez powtarzania przypisania SQLite.

W razie konfliktu numeru ISBN z już istniejącym wydaniem SQLite nowy zapis zostanie odrzucony kodem `SQLITE_ISBN_ALREADY_EXISTS`, zamiast tworzyć drugie wydanie. Przypisanie wymaga, aby oferta i wydanie były już obecne w SQLite; brak tożsamości skutkuje błędem, a nie milczącym utworzeniem danych.

Ta funkcja **nie usuwa** starych zapisów JSON i **nie przenosi** automatycznie wszystkich historycznych decyzji użytkownika; nadal potrzebny jest test migracji na kopii danych użytkownika oraz przejście pozostałych zapisów aplikacji na pojedynczą bazę.

## Podsumowanie skanu przechowywane w SQLite

Migracja `006_scan_runs.sql` wprowadza tabelę `scan_runs`. Podczas skanowania status (liczba znalezionych ofert, nowych ofert, zmian cen i błędy źródeł) jest zapisywany w **tej samej transakcji SQLite** co oferty. Odczyt `/api/history` w trybie `BOOKFLIP_SQLITE_HISTORY_READ=1` odtwarza teraz pole `lastScan`.

Dane starszych skanów zapisane tylko w historycznym pliku JSON nie są automatycznie przenoszone do nowej tabeli. Przed porzuceniem JSON nadal należy sprawdzić starsze raporty i szczegóły skanowania na kopii istniejących danych.

## Próbna migracja na osobnej kopii bazy

Po pobraniu aktualnego kodu uruchom z terminala w folderze BookFlip:

```powershell
npm run rehearse:history -- --json ".\\scan-results\\local-offer-history.json" --sqlite ".\\scan-results\\bookflip-catalog.sqlite" --output ".\\migration-trial-1"
```

Ścieżka `--output` **nie może istnieć** przed uruchomieniem. Program tworzy tam kopię JSON i spójny snapshot SQLite z użyciem funkcji backup SQLite (uwzględnia zatwierdzone dane WAL). Następnie uruchamia import historii **wyłącznie na kopii bazy**, porównuje stan przed i po oraz generuje plik `migration-rehearsal-report.json`. Oryginalne pliki są otwierane tylko do odczytu.

Wynik nie jest automatyczną zgodą na wyłączenie JSON. Sprawdź `before`, `after`, `import.conflicts` i kopie próbnych danych; w szczególności przypisania ISBN, ręczne decyzje oraz różnice historii cen. Kod wyjścia: `0` — brak wykrytych blokujących różnic w zakresie raportu, `1` — rozbieżności, `2` — błąd narzędzia. Nie wskazuj jako `--output` folderu zawierającego oryginalne dane i nie usuwaj plików oryginalnych po wykonaniu próby.
