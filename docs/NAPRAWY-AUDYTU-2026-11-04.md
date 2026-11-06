# Naprawy po analizie projektu — 4 listopada 2026

Wdrożono poprawki wszystkich ośmiu ustaleń audytu:

1. Nowa migracja `103_excluded_review_decisions.sql` rejestruje przebudowę tabeli decyzji. Istniejące pliki SQL pozostają niezmienione. Runner zachowuje indeksy i triggery, sprawdza klucze obce przed COMMIT i przywraca ich ustawienie również po błędzie. Brak wersji 103 uruchamia istniejący mechanizm backupu przed migracją. Bazy wcześniej rozszerzone przez runtime są obsługiwane bez ponownej przebudowy.
2. Głębokość transakcji jest przywracana raz, w `finally`, także po błędzie COMMIT.
3. Wyszukiwanie dzieł, autorów, ofert i kolejki używa tej samej normalizacji NFC i małych liter Unicode po obu stronach zapytania. Znaki diakrytyczne pozostają znaczące.
4. JSON jest dekodowany dopiero po zebraniu buforów; limit 32 KiB nadal jest liczony w bajtach.
5. Statystyki książek są agregowane jednym przebiegiem. Pełne odpowiedzi starszego API nadal zawierają wszystkie oferty dla zgodności, ale nie wczytują wszystkich obserwacji cenowych: minima oblicza SQL. Ręczne utworzenie książki używa projekcji wskazanej książki bez historii cen. Analiza skanu grupuje identyfikatory raz dla każdego wydania zamiast wielokrotnie filtrować całą listę.
6. `npm test` uruchamia testy z osobnym tymczasowym katalogiem danych w każdym procesie i limitem 30 sekund. Bezpośrednie `node --test` omija przygotowanie środowiska; zalecanym poleceniem pozostaje `npm test`.
7. Filtry CI obejmują pliki `.js`, konfigurację narzędzi i manifesty pakietów. CI używa tego samego izolowanego runnera.
8. `.gitignore` obejmuje `*.sqlite`, `*.sqlite3` i `*.db`.

Dodano testy regresji dla nieudanego COMMIT, zagnieżdżenia po błędzie, polskich znaków i normalizacji Unicode, podziału UTF-8, backupu starego schematu, wycofania niepoprawnej migracji, baz wcześniej rozszerzonych i zgodności statystyk. Benchmark ma wariant `--matched` z osobnym wydaniem dla każdej oferty.

Kontrole lokalne: **377/377 testów Node zaliczonych**, bez pominiętych testów; kontrola składni obejmuje **174 moduły JavaScript**. Lint, Prettier i smoke Chromium wymagają zależności nieobecnych w tym folderze; próba instalacji npm została zablokowana przez dostęp do rejestru, a cache offline nie zawierał ESLint. Nie wykonano skanowania rzeczywistych portali ani migracji prywatnej bazy użytkownika. Aktualizacja schematu i backup nastąpią przy otwarciu bazy przez zaktualizowaną aplikację.

Benchmark 1 000 ofert z osobnymi wydaniami: pierwszy zapis 1 215,80 ms, ponowny skan ze zmianą 10% cen 1 811,66 ms. To pojedyncza próba syntetyczna; przygotowanie przypisań nie jest wliczone w czas skanu. Nie stanowi porównania szybkości z poprzednim kodem ani pomiaru portali.
