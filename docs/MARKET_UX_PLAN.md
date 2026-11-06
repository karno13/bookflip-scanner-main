# Plan przebudowy BookFlip: rynek jako główny obszar pracy

Status: specyfikacja do realizacji, przygotowana po przeglądzie kodu. Nie stanowi wizualnej weryfikacji aktualnej aplikacji. Nie wymaga zmiany API, bazy ani algorytmów identyfikacji.

## Cel produktu

Główna ścieżka: znajdź ofertę -> sprawdź konkretne wydanie -> porównaj zapisane oferty tego wydania -> podejmij i zapisz decyzję -> wróć do tego samego miejsca na liście.

Ekran startowy: Rynek, oparty na istniejącym widoku offers. Skaner zasila rynek. Katalog dostarcza kontekst wydania, a weryfikacja jest kolejką wyjątków.

## Ustalenia przeglądu kodu

| Problem | Wpływ | Priorytet |
| --- | --- | --- |
| Kalkulator otwiera section i zamyka details w scenarioCalculatorMarkup | Przeglądarka naprawia błędny HTML; układ i zwijanie są nieprzewidywalne | P0 |
| Szczegóły mobilne mają wyłącznie stan klasy CSS, bez historii nawigacji | Wstecz przeglądarki nie odpowiada przejściu lista-szczegóły | P0 |
| Przejście z oferty do weryfikacji nie korzysta ze wspólnego otwierania szczegółów | Na telefonie zadanie może zostać wybrane, a formularz pozostać ukryty | P0 |
| Porównanie wydania jest umieszczone po formularzu decyzji i kalkulatorze | Najważniejsza informacja do oceny rynku pojawia się za późno | P1 |
| Historia ogłoszenia i ceny innych ofert mają różne znaczenie, lecz podobną prezentację | Ryzyko błędnej interpretacji cen | P1 |
| Status zakupowy, obserwowanie i identyfikacja konkurują na liście | Użytkownik nie ma jednej hierarchii informacji | P1 |
| Skaner jest domyślnym ekranem | Każda sesja zaczyna się od procesu pozyskiwania danych | P1 |
| Filtry nie eksponują wyraźnie całego aktywnego kontekstu | Trudno rozpoznać przyczynę brakujących wyników | P1 |
| Szczegóły są składane przez HTML, dopinanie elementów i zmianę ich kolejności | Kolejność treści zależy od kilku miejsc kodu | P1 |
| Wyszukiwanie, listy i szczegóły mają niespójny stan i sposób odświeżania | Ryzyko utraty miejsca, fokusu lub edycji przy przejściach | P1 |
| Duża część testów UI sprawdza regexy CSS i HTML | Nie wykrywa nachodzenia, złej kolejności ani niewygodnej interakcji | P0 |

Pliki: app/views/offers.js, app/views/catalog.js, app/views/review.js, app/views/sets.js, app/views/trading-controls.js, app/core/detail-navigation.js, app/core/ux.js oraz cztery arkusze stylów.

## Docelowa nawigacja

Telefon: Rynek, Obserwowane, Skaner, Weryfikacja, Więcej. Obserwowane otwiera istniejący filtr ofert. Więcej udostępnia Katalog, Zestawy i Ustawienia. Wszystkie dotychczasowe trasy pozostają dostępne. Desktop: te same obszary oraz bezpośrednie przejścia do katalogu i zestawów.

Stan listy obejmuje frazę, źródła, statusy, sortowanie, zakres ceny, skan, stronę i przewinięcie. Wstecz zamyka kolejny poziom szczegółów. Odrzucanie niezapisanych danych wymaga dotychczasowej decyzji użytkownika; prezentacyjny powrót nie zapisuje i nie resetuje formularza.

## Rynek

Nagłówek i liczba wyników. Wyszukiwanie. Krótki pasek istniejących widoków zakupowych. Widoczny wybór sortowania. Jeden panel pozostałych filtrów. Aktywne filtry opisane na liście z możliwością pojedynczego usunięcia i wyczyszczenia całości. Widoczny zakres wyników i następna strona.

Wiersz: tytuł (zawijany, pełny w szczegółach), cena w stałym miejscu, źródło, aktualność ostatniej obserwacji, status decyzji. Ostrzeżenie o identyfikacji pojawia się wtedy, gdy wpływa na porównywalność. ISBN i rozbudowana bibliografia należą do szczegółów. Zestawy są odróżnione od pojedynczych książek. Brak deklaracji okazji na podstawie samej ceny.

Desktop: szeroka lista i panel wybranej oferty obok, bez blokowania reszty aplikacji modalem. Telefon: pełny widok szczegółów. Jednoznaczny stan zaznaczenia, fokus i powrót.

## Szczegóły oferty

1. Tytuł, cena, źródło, aktualność i dostępność zgodnie z zapisanymi danymi.
2. Otwórz ogłoszenie, obserwowanie i aktualny status zakupowy.
3. Identyfikacja wydania: przypisane wydanie, ISBN, pewność wynikająca z istniejących statusów. Przy braku przypisania przejście do weryfikacji.
4. Porównanie zapisanych ofert tego samego wydania: tytuł, źródło, cena, aktualność, dostępność i możliwość otwarcia oferty.
5. Edytor decyzji: status, cena docelowa, notatka, jawne Zapisz i komunikat o wyniku.
6. Rozwijane: historia tego ogłoszenia, kalkulator, dodatkowe metadane.

Porównanie nie miesza różnych wydań ani pojedynczych książek z pakietami. Stan egzemplarza i dostawa nie są dopowiadane. Niepotwierdzona dostępność jest opisana. Mediana zapisanych cen ofertowych nie jest nazywana wartością rynkową ani potwierdzoną ceną sprzedaży.

## Pozostałe ekrany

Skaner: frazy -> źródła -> uruchom/anuluj -> jeden postęp -> wyniki -> przejście do odpowiednio przefiltrowanego rynku. Profile obok wyszukiwania. Diagnostyka rozwijana. Ostatnie oferty nie dominują nad wynikiem uruchomionego skanu.

Weryfikacja: kolejka decyzji; kompaktowe podsumowanie procesu; po wyborze oferta, kandydat wydania i istotne rozbieżności; ręczne wyszukiwanie, zatwierdzenie, odrzucenie i alternatywne działania. Wyświetlenie kandydata nie zatwierdza go i nie zmienia obecnych warunków zapisu.

Katalog: wyszukiwarka książek; wybór dzieła -> wydania -> ofert konkretnego wydania. Bibliografia na początku, edycja i łączenie duplikatów w opcjach dodatkowych. Widoczne rozróżnienie dzieła, wydania i ogłoszenia.

Zestawy: lista pakietów -> zawartość wybranego pakietu. Cena i źródło dotyczą całości. Widoczne pozycje rozpoznane i nieznane, stan kompletności i istniejące potwierdzenie składu. Edycja ilości i cen, dodawanie książek i kalkulator dostępne kontekstowo.

Ustawienia: źródła i ich kondycja, domyślne koszty, dane i kopie, import, diagnostyka. Sprawy techniczne nie zajmują miejsca w codziennym przeglądaniu.

## Warstwa wizualna

Neutralne tło, czytelny tekst, biały obszar listy, subtelne separatory, zielony akcent dla głównej akcji i wyboru. Brak wielu kart na poziomie pojedynczych wartości. Cena w stałej kolumnie. Typografia: nagłówek 22-24 px, tytuł pozycji 14-16 px, metadane 12-13 px. Kontrolki 44 px. Długie nazwy, błędy i puste stany projektowane razem z normalnym widokiem.

## Kolejność realizacji i bramki odbioru

A. Stabilność: poprawny HTML, jednolita historia przejść, otwieranie weryfikacji z oferty, zachowanie formularzy. Odbiór na rzeczywistym DOM.
B. Jeden pełny przepływ Rynek -> oferta -> porównanie -> zapis -> powrót. Odbiór na telefonie i desktopie przed przeniesieniem wzorca na inne ekrany.
C. Skaner, weryfikacja, katalog, zestawy i ustawienia w tym samym wzorcu.
D. Końcowe porządkowanie stylów, usunięcie martwego widoku tabeli po sprawdzeniu wszystkich jego funkcji, ujednolicenie etykiet, stanów i obsługi klawiatury.
E. Weryfikacja kompletnej aplikacji i korekty po przejściu scenariuszy.

## Weryfikacja

Szerokości 320, 375, 390, 430, 768, 1024 i 1440 px. Scenariusze: znalezienie i porównanie wydania; zapis obserwowania/statusu/notatki; przejście oferta-weryfikacja i powrót; zapis i powrót w katalogu; praca nad zestawem; anulowanie skanu; brak wyników; błąd pobierania/zapisu; brak ISBN; długie tytuły; szybkie przełączanie ofert; niezapisane zmiany; odświeżenie; Wstecz; klawiatura i fokus.

Cele do sprawdzenia: zero poziomego przewijania strony, zero zasłoniętych kontrolek, wszystkie trasy osiągalne, brak zapisu przy samym przełączaniu paneli, niezmienione zasady zatwierdzania. Przy 390x844 minimum pięć typowych wierszy rynku; przy 320x568 minimum trzy. To cele projektowe, nie aktualnie zmierzone wyniki. Długich tytułów nie skraca się kosztem kluczowych danych, aby sztucznie spełnić te liczby.

Czas i liczba działań dla trzech podstawowych zadań zostaną zmierzone przed i po przebudowie. Wynik testów jednostkowych, testy przeglądarkowe i ocena wizualna są raportowane oddzielnie.

## Granica zakresu

Najpierw przebudowa istniejących danych i funkcji. Ranking okazji, alerty, nowe integracje, automatyczna wycena i nowe reguły identyfikacji nie są potrzebne do realizacji tego planu i wymagają osobnej specyfikacji.

## Priorytet etapu: katalog i budowanie historii

Zgodnie z decyzją użytkownika centrum tej wersji jest Katalog, nie Rynek. Katalog jest ekranem startowym i pierwszą widoczną zakładką telefonu. Weryfikacja, skaner i oferty wspierają budowanie katalogu i obserwacji. Zestawy i ustawienia pozostają dostępne przez Więcej.

W szczegółach wydania dodano historię zapisanych obserwacji pobieraną z istniejących endpointów ofert. Odczyt odbywa się na żądanie, maksymalnie 20 ofert na partię, cztery równoległe żądania. Obserwacje są sortowane według daty, a lista renderuje po 30 wpisów. Nie tworzy się fikcyjnych punktów dla ofert bez historii. Aktualne przypisanie ogłoszenia do wydania nie jest przedstawiane jako historycznie potwierdzone przypisanie. Częściowe błędy nie usuwają poprawnie wczytanych danych i mogą być ponowione.

Dodano bezpośrednie przejście z oferty do wydania i historii w katalogu. Powrót do już otwartego wydania zachowuje wczytaną historię. Poprawiono otwieranie mobilnej weryfikacji z oferty oraz nieprawidłowe znaczniki kalkulatora. Zabezpieczono szczegóły katalogu przed zastąpieniem ich spóźnioną odpowiedzią wcześniejszego żądania.
