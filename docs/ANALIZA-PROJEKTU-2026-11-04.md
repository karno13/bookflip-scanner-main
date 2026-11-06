# Analiza projektu BookFlip — 4 listopada 2026

> Aktualizacja po audycie: poprawki zostały wdrożone w kodzie. Opis poniżej
> zachowuje stan i wyniki pierwotnej analizy. Zakres napraw oraz aktualną
> weryfikację opisuje [raport napraw](NAPRAWY-AUDYTU-2026-11-04.md).

## Ocena ogólna

BookFlip 3.2.0 ma solidne podstawy lokalnej aplikacji do wyszukiwania i oceny ofert książek. Najmocniejsze elementy to relacyjny katalog SQLite, oddzielenie dzieła od wydania i oferty, ostrożne przypisywanie ISBN, historia decyzji oraz szeroki zestaw testów. Nie wymaga przepisywania od podstaw. Największą wartość przyniesie poprawa niezawodności warstwy danych, polskiego wyszukiwania i izolacji testów.

Analiza obejmuje kod serwera, API, skanowania, identyfikacji, SQLite, interfejsu, narzędzi backupu i konfiguracji CI. Jest audytem technicznym kodu z lokalnymi testami, a nie audytem wizualnym UX ani sprawdzeniem bieżącej skuteczności parserów na portalach. Nie zmieniano kodu aplikacji ani świadomie nie otwierano prywatnej bazy. Folder roboczy nie zawiera metadanych `.git`, więc nie można zweryfikować historii zmian ani stanu gałęzi.

## Architektura i przepływ danych

1. `app/` dostarcza interfejs bez frameworka i bundlera: moduły JavaScript, HTML i CSS; sześć głównych widoków.
2. `local-app.mjs` uruchamia HTTP na `127.0.0.1`, udostępnia API i pliki interfejsu, koordynuje skanowanie oraz identyfikację.
3. `marketplaces.mjs`, `local-scan.mjs` i moduły Vinted pobierają oraz normalizują oferty. Mechanizmy retry, ograniczania tempa i cache ograniczają zbędne żądania.
4. `sqlite-single-store.mjs` zapisuje wyniki przez `catalog-production.mjs` i `sqlite-catalog-repository.mjs`.
5. `identification-worker.mjs`, `catalog-resolver.mjs` i adaptery metadanych weryfikują ISBN i przypisania; niejednoznaczne przypadki trafiają do ręcznej decyzji.
6. `catalog-api.mjs` dostarcza stronicowane odczyty. `sqlite-history-read.mjs` utrzymuje zgodność ze starszym modelem historii.

Model danych rozdziela `works`, `editions`, `edition_identifiers`, `offers`, `offer_matches`, historię cen, dowody metadanych, zadania identyfikacji i decyzje. Dodatkowe tabele przechowują zestawy, notatki zakupowe, profile skanowania i cache. To dobry kierunek dla identyfikacji towaru i porównywania wydań.

## Weryfikacja wykonana lokalnie

Środowisko: Windows, Node.js v24.13.0.

| Kontrola | Wynik i ograniczenia |
| --- | --- |
| Testy Node | 368/368 zaliczonych, 0 pominiętych; około 7,57 s, po wskazaniu tymczasowego katalogu stanu |
| Składnia | 171 modułów JavaScript bez błędów |
| ESLint | Nie wykonano skutecznie: brak lokalnie zainstalowanego ESLint |
| Prettier | Nie zweryfikowano; brak zainstalowanych narzędzi developerskich |
| Chromium smoke | Nie uruchomiono lokalnie; skrypt wymaga niezainstalowanego Playwright |
| Działanie rzeczywistych portali | Nie testowano; testy offline nie potwierdzają aktualnych struktur serwisów |
| Podatności zależności | Nie wykonano audytu rejestru pakietów ani przeglądu aktualnych advisory |

Pełny, zakończony przebieg testów uruchomiono ze zmienną `BOOKFLIP_CATALOG_DB` wskazującą `%TEMP%/bookflip-analysis-isolated/runtime.sqlite` i limitem `--test-timeout=20000`. Pierwszy przebieg bez izolacji zawieszał się; przebieg z limitem pokazał timeout testu anulowania HTTP. Zależność od zapisu stanu w domyślnym katalogu użytkownika jest istotna w środowisku ograniczającym zapis. Wynik 368/368 dotyczy przebiegu izolowanego, nie pierwszej próby.

### Benchmark syntetyczny SQLite

| Oferty | Pierwszy zapis | Powtórny skan, zmiana 10% cen | SQLite + WAL | RSS procesu |
| --- | ---: | ---: | ---: | ---: |
| 1 000 | 597,65 ms | 407,01 ms | 1,93 MB | 70,66 MB |
| 10 000 | 12 534,88 ms | 3 666,08 ms | 17,00 MB | 158,47 MB |

Liczby nowych ofert i zmian cen były zgodne z oczekiwaniami. Pomiar wykonano raz dla każdej wielkości; nie jest medianą serii pomiarowej. Obejmuje syntetyczne oferty bez rzeczywistego pobierania i bez reprezentatywnego rozkładu przypisań do wydań. Nie pozwala wyznaczyć czasu skanowania Vinted, OLX czy innych portali. Pierwszy zapis 10 000 ofert trwał około 21 razy dłużej niż 1 000 — warto zmierzyć osobno narzut indeksów, transakcji i przygotowywania SQL przed wyborem optymalizacji.

## Ustalenia wymagające działania

P1 oznacza wysoki priorytet związany z poprawnością lub ochroną danych; P2 — istotną poprawkę funkcjonalną, wydajnościową lub utrzymaniową. Nie stwierdzono potwierdzonej krytycznej podatności w zbadanych ścieżkach; nie jest to gwarancja braku podatności.

### 1. P1: przebudowa tabeli omija warunek automatycznego backupu

**Miejsce:** `catalog-migrations.mjs:29`, `catalog-migrations.mjs:108`, `catalog-data-location.mjs:27`.

`allowExcludedReviewDecisions()` przebudowuje `review_decisions` poza listą migracji SQL. Tymczasem `backupBeforeMigrations()` sprawdza wyłącznie brakujące numery migracji. Jeżeli baza ma już wszystkie numery, ale starszy CHECK bez `excluded`, przebudowa tabeli nastąpi bez nowego backupu przed tą zmianą. Kod wykonuje ją transakcyjnie, co ogranicza ryzyko, lecz nie spełnia deklaracji dokumentacji o backupie przed zmianą struktury. Ponadto kontrola kluczy obcych następuje po COMMIT, więc jej błąd nie wycofa przebudowy.

**Zalecenie:** dodać nową, wersjonowaną migrację dla tej zmiany, bez modyfikowania historycznych migracji; kontrolować integralność przed zatwierdzeniem. Sprawdzić scenariusz bazy z pełnym rejestrem wersji i poprzednim ograniczeniem CHECK.

### 2. P1: licznik transakcji uszkadza się po błędzie COMMIT

**Miejsce:** `sqlite-catalog-repository.mjs:69`, `sqlite-catalog-repository.mjs:73`.

`transaction()` zmniejsza `this.depth` przed COMMIT/RELEASE i ponownie w `catch`. Jeżeli zawiedzie samo zatwierdzanie, licznik spada poniżej poprawnej wartości. Dla transakcji głównej potwierdzono `depthAfterError=-1` przez naruszenie odroczonego klucza obcego. Kolejna prosta transakcja może się udać, ale mechanizm wykrywania zagnieżdżenia pozostaje uszkodzony. Reprodukcja używała dodatkowych tabel w bazie pamięciowej; nie wykazano wystąpienia tego błędu w normalnej pracy obecnego schematu.

**Zalecenie:** przywracać poprzednią głębokość dokładnie raz, w `finally`; osobno obsłużyć błędy zatwierdzenia i wycofania. Dodać test błędu COMMIT oraz poprawnego zagnieżdżenia po takim błędzie.

### 3. P2: wyszukiwanie pomija polskie wielkie litery

**Miejsce:** `catalog-api.mjs:22`, `catalog-api.mjs:75`, analogiczne filtry ofert i kolejki.

Zapytanie jest zamieniane na małe litery przez JavaScript, a tytuł przez SQLite `lower()`. W użytym runtime SQLite operacja ta nie obniża polskich liter tak jak JavaScript. Reprodukcja: dodanie dzieła `ŻABA` daje `total=1`, ale wyszukanie zarówno `ŻABA`, jak i `żaba` zwraca `0`. To błąd bezpośrednio dotykający polskiego katalogu.

**Zalecenie:** zastosować jednolitą normalizację Unicode przy zapisie i wyszukiwaniu, objąć nią także autorów i tytuły ofert. Ustalić osobno, czy wyszukiwanie bez znaków diakrytycznych ma być wspierane. Dodać przypadki Ł/ł, Ż/ż, Ś/ś i polskie nazwiska.

### 4. P2: dekodowanie JSON może uszkodzić polskie znaki

**Miejsce:** `local-app.mjs:379–387`.

`readJson()` wykonuje `text += chunk`, dekodując każdy Buffer oddzielnie. Jeżeli wielobajtowy znak UTF-8 zostanie rozdzielony pomiędzy fragmenty strumienia, wynik może zawierać znak zastępczy. JSON może nadal być poprawny składniowo, ale tytuł lub notatka zostaną zmienione. To ustalenie z przeglądu kodu; nie przeprowadzono pełnej reprodukcji przez HTTP.

**Zalecenie:** zebrać bufory z zachowaniem limitu bajtów i wykonać `Buffer.concat(chunks).toString('utf8')` albo użyć dekodera strumieniowego. Dodać test dzielący polski znak pomiędzy dwa fragmenty.

### 5. P2: starsze endpointy nadal materializują cały katalog

**Miejsce:** `local-app.mjs:468–479`, `local-app.mjs:620`, `sqlite-single-store.mjs:18`, `sqlite-single-store.mjs:91`.

Nowy interfejs korzysta ze stronicowania i lekkiej historii, co jest zaletą. Pozostałe ścieżki `/api/history`, tworzenia i ręcznego przypinania książki nadal odczytują pełny model historii. `historySnapshot()` dla każdej książki ponownie przegląda oferty i historię cen. Koszt rośnie w przybliżeniu jak liczba książek razy liczba ofert i punktów historii. Synchroniczne operacje wykonują się w procesie obsługującym HTTP, więc duży katalog może opóźniać pozostałe żądania.

W `persistSqliteScan()` dodatkowo występuje `ordered.filter(...)` dla każdej grupy książki (`sqlite-single-store.mjs:156`): przy wielu różnych przypisanych wydaniach może powstać koszt kwadratowy. Obecny benchmark ofert bez przypisań nie sprawdza tego wariantu.

**Zalecenie:** zwracać z mutacji tylko zmieniony rekord i liczniki; agregować statystyki SQL lub jednym przebiegiem; grupować identyfikatory ofert razem z budowaniem `byBook`. Dodać benchmark dużej historii i skanu przypisanego do wielu różnych wydań.

### 6. P2: testy HTTP zależą od katalogu danych użytkownika

**Miejsce:** `local-app.mjs:409–410`, `scan-cancel-http.test.mjs`.

Ścieżki logu i `scan-status.json` są ustalane podczas importu modułu na podstawie domyślnej lokalizacji katalogu. Wstrzyknięcie katalogu `:memory:` do serwera nie izoluje tych plików. Test może próbować zapisać stan w rzeczywistym katalogu aplikacji. Jeżeli zapis zawiedzie przed wywołaniem testowego skanera, test anulowania czeka na `startedPromise`, które nigdy nie zostanie rozwiązane. Domyślny skrypt testów nie narzuca limitu czasu.

**Zalecenie:** wstrzykiwać magazyn stanu i logger do serwera albo ustalać tymczasowe ścieżki przed importem testowanych modułów. Każde oczekiwanie na start operacji powinno mieć limit czasu. Rozdzielić dane równoległych przebiegów testów.

### 7. P2: filtry CI nie obejmują wszystkich zmian testów i narzędzi

**Miejsce:** `.github/workflows/scanner-tests.yml:5–18`.

Testy w `test/*.test.js` nie pasują do `**/*.mjs` ani do `app/**`. PR zmieniający wyłącznie taki test może nie uruchomić głównego workflow. W filtrze `pull_request` brakuje też `package.json`, `.prettierrc.json` i `eslint.config.mjs`, mimo że workflow ich używa.

**Zalecenie:** uwzględnić `**/*.js` i pliki narzędzi albo usunąć selekcję ścieżek dla podstawowego workflow. Zachować macierz Windows/Linux i Node 22.16/24.

### 8. P2: ochrona przed przypadkowym dodaniem bazy jest niepełna

**Miejsce:** `.gitignore`.

Ignorowane są `scan-results/` i pliki pomocnicze WAL/SHM, ale brakuje ogólnych wzorców dla `*.sqlite` i `*.db`. Domyślne dane znajdują się poza projektem, co zmniejsza ryzyko. Baza wskazana przez konfigurację lub backup zapisany w repozytorium mogą jednak zostać przypadkowo dodane do Git. Nie stwierdzono w tym audycie publikacji prywatnej bazy.

**Zalecenie:** ignorować bazy i backupy z precyzyjnymi wyjątkami, jeśli w przyszłości będą potrzebne kontrolowane fixture binarne.

## Bezpieczeństwo i trwałość — mocne strony

- Serwer startuje na loopback. Waliduje Host, Origin i JSON dla operacji mutujących; limit treści żądania wynosi 32 KiB.
- Obsługa Tailscale sprawdza skonfigurowany host, nagłówek użytkownika i połączenie z loopback. To rozwiązanie dla prywatnego dostępu przez zaufany lokalny proxy, nie model publicznej usługi wieloużytkownikowej.
- Statyczne pliki przechodzą kontrolę ścieżki, `realpath` i granicy katalogu. Odpowiedzi zawierają CSP, `nosniff` i politykę referrera.
- Przejrzane ścieżki SQL wiążą wartości przez parametry; dynamiczne sortowanie korzysta z kontrolowanych wariantów. Nie znaleziono potwierdzonego SQL injection w tych ścieżkach.
- SQLite używa foreign keys, WAL, transakcji i ograniczeń schematu. Wersjonowane migracje mają sumy kontrolne.
- Backup i restore mają oddzielne narzędzia i testy; dokumentacja poprawnie odróżnia lokalną kopię od ochrony przed awarią dysku.
- Pakiet nie deklaruje zależności produkcyjnych npm. Upraszcza to uruchomienie i ogranicza liczbę zależności wymagających aktualizacji.

## Jakość kodu, testów i utrzymanie

Podział na adaptery źródeł, repozytorium, resolver i widoki jest czytelny. Wstrzykiwanie fetchera, zegara i skanera umożliwia testy offline. Testy obejmują konflikty ISBN, migracje, odtwarzanie, zapis SQLite, ograniczenia żądań, anulowanie oraz bezpieczeństwo HTTP.

Część testów interfejsu sprawdza tekst plików i obecność wzorców zamiast wykonywać zachowanie w przeglądarce. Są użyteczne jako kontrola kontraktu kodu, ale nie dowodzą poprawności interakcji. Istniejący smoke Chromium sprawdza realne ścieżki, między innymi widoki, szczegóły, kalkulator, notatki i profile; należy utrzymać jego regularne wykonywanie.

`local-app.mjs` ma ponad tysiąc linii i łączy routing, skanowanie, strumieniowanie, pliki stanu, logowanie i lifecycle. Rozdzielenie routerów oraz magazynu stanu ułatwi testowanie i ograniczy zależności globalne. Nie ma potrzeby wprowadzać frameworka wyłącznie dla samego podziału.

ESLint ma sześć podstawowych reguł poprawności. Nie sprawdza obecnie wielu klas błędów, np. niezdefiniowanych zmiennych. `format:check` obejmuje tylko trzy pliki konfiguracyjne, mimo że `format` formatuje szeroką część repozytorium. Nazwa i dokumentacja powinny jasno oddawać ten zakres. Brak lockfile zmniejsza odtwarzalność zależności przechodnich narzędzi developerskich mimo przypięcia ich wersji głównych pakietów.

Dokumentacja dobrze opisuje przeznaczenie handlowe, lokalny model danych i bezpieczne aktualizacje. Mapa repozytorium wymienia jednak migracje tylko do `007`, mimo obecności `099–102`; komentarz workflow smoke nadal mówi o pięciu widokach. To drobne oznaki rozbieżności dokumentacji z implementacją.

## Kierunek produktu

Projekt wspiera pozyskiwanie ofert, identyfikację, porównania, listę zakupową, próg ceny i prosty scenariusz odsprzedaży. Sama etykieta „okazja” oparta na medianie cen ofertowych nie dowodzi osiągalnej ceny sprzedaży ani zysku. W analizowanej klasyfikacji nie widać pełnego uwzględnienia wieku obserwacji, waluty, stanu egzemplarza i kosztów transakcyjnych. Nie należy interpretować tej etykiety jako prognozy rentowności.

Najbardziej spójne rozszerzenia to jakość i świeżość porównań, jawne założenia kosztowe oraz pomiar rzeczywistego wyniku zakupu i odsprzedaży. Rozbudowa funkcji kolekcjonerskich byłaby sprzeczna z zadeklarowanym kierunkiem produktu.

## Zalecana kolejność prac

1. Naprawić głębokość transakcji i objąć zmianę CHECK wersjonowaną migracją z backupem.
2. Poprawić normalizację polskiego wyszukiwania i dekodowanie żądań UTF-8.
3. Odizolować pliki testów, ustawić limity czasu, uzupełnić filtry CI i `.gitignore`.
4. Zmierzyć duży katalog z przypisaniami i historią, następnie usunąć pełne projekcje z mutacji i wielokrotne skanowanie tablic.
5. Uruchomić lint, kontrolę formatowania i smoke Chromium w przygotowanym środowisku; uzupełnić testy zachowania dla wykrytych błędów.
6. Kontynuować rozwój wyceny i procesu handlowego po uszczelnieniu poprawności danych.

Nie przygotowano poprawek implementacyjnych w ramach tej analizy. Wszystkie wskazane priorytety są oceną audytową, a wyniki benchmarków odnoszą się wyłącznie do opisanych lokalnych prób.
