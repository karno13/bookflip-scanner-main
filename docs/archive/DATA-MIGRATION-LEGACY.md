> Historyczne notatki z migracji JSON → SQLite, archiwum. Nie opisują aktualnej ścieżki uruchomienia.

# BookFlip: magazyn SQLite i zgodność ze starszym JSON

## Aktualny stan (od PR #36)

**Domyślnie aplikacja działa w trybie `BOOKFLIP_STORAGE=sqlite`.** Skanowanie, ręczne dodawanie książek i przypisywanie ofert, historia cen, kolejka identyfikacji ISBN oraz odczyty `/api/history` i `/api/book` używają SQLite jako jedynego aktywnego magazynu. Domyślny skan nie zapisuje pliku `scan-results/local-offer-history.json`.

Starsza ścieżka `BOOKFLIP_STORAGE=json` pozostaje dostępna wyłącznie do obsługi historycznych danych i kompatybilności. **Nie oznacza to podwójnego zapisu w domyślnym trybie**, ale kod dwóch ścieżek nadal jest utrzymywany. Przełączniki `BOOKFLIP_SQLITE_FIRST` i `BOOKFLIP_SQLITE_MANUAL_WRITE` dotyczą wyłącznie historycznego trybu JSON, nie są potrzebne dla nowych instalacji.

## Nowa instalacja bez danych

1. Uruchom `npm start` (Node.js 24 lub nowszy). SQLite powstanie w `scan-results/bookflip-catalog.sqlite`.
2. Skany i decyzje zapisują się do SQLite; nie ma etapu importu JSON.
3. Nie uruchamiaj dwóch instancji na tym samym pliku bazy. Wykonuj kopie bezpieczeństwa SQLite.

## Istniejąca instalacja z danymi JSON

Przed przejściem na SQLite wykonaj kopie plików, sprawdź `npm run check:history` i przetestuj `npm run rehearse:history` na osobnych kopiach. Nic nie jest usuwane ani migrowane automatycznie. Dalsze sekcje opisują zarówno bieżące narzędzia diagnostyczne, jak i historyczne etapy przejścia; ich opisy trybu JSON **nie są opisem domyślnych ustawień**.

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

## Uruchomienie projektu od zera: jeden magazyn SQLite

**Od tego etapu domyślny tryb aplikacji to `BOOKFLIP_STORAGE=sqlite`.** Skanowanie, wyświetlanie historii, tworzenie ręcznych książek i przypisywanie ofert operują bezpośrednio na pliku `scan-results/bookflip-catalog.sqlite`. Nowe skany nie zapisują pliku JSON. Podsumowanie skanu jest utrwalane w tabeli `scan_runs`, a ceny w `offer_price_history`.

Dla starej instalacji z danymi JSON dostępne jest jawne `BOOKFLIP_STORAGE=json` (tylko zgodność), lecz aplikacja nie wykonuje automatycznej migracji tych danych. Aby zachować istniejącą historię, należy najpierw użyć `npm run rehearse:history` i zweryfikować raport.

W nowym trybie dane o książkach bez aktywnego, potwierdzonego przypisania ISBN nie są automatycznie łączone na podstawie samego tytułu; kolejka weryfikacji pozostaje źródłem prawdy o niepewnych wydaniach.

Nie należy jednocześnie uruchamiać dwóch instancji BookFlip na tej samej bazie. Tryb JSON pozostaje tylko na potrzeby kompatybilności i nie jest domyślną ścieżką zapisu.

## Automatyczne wznowienie identyfikacji ISBN

Podczas normalnego uruchomienia `npm start` BookFlip uruchamia worker identyfikacji zadań już zapisanych w SQLite: wykonuje pierwszą partię po otwarciu lokalnego serwera, a potem sprawdza zadania w regularnych odstępach (domyślnie co 30 sekund). Nie trzeba uruchamiać kolejnego skanu, aby obsłużyć gotowe zadania o statusie `queued`, `retry_wait` z upłyniętym `run_after` albo `running` z wygasłą dzierżawą.

Wyłącznik `BOOKFLIP_CATALOG_AUTO_RESOLVE=0` wyłącza planowanie automatyczne; `BOOKFLIP_IDENTIFICATION_POLL_MS` ustawia interwał od 1000 do 3600000 ms. Przetwarzanie jednej partii pozostaje ograniczone przez istniejący `BOOKFLIP_CATALOG_BATCH` (domyślnie 5). Powtórne tyknięcia planisty nie uruchamiają równoległego workera; skany korzystają z tej samej blokady uruchamiania.

Zadania wymagające ręcznej kontroli (`review_required`) i trwałe błędy (`failed`) nie są automatycznie wznawiane bez decyzji użytkownika. Ponowienie po błędzie tymczasowym respektuje zapisany w SQLite termin `run_after`; limity zapytań do BN/Open Library pozostają aktywne.
