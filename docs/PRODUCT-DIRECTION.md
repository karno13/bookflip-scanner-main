# Kierunek produktu BookFlip — handel książkami, nie kolekcjonerstwo

## Decyzja produktowa

**BookFlip to narzędzie do handlu książkami: wyszukiwania okazji, oceny ryzyka i opłacalności, zakupu z myślą o odsprzedaży oraz monitorowania ofert i cen. Nie budujemy aplikacji do zarządzania prywatną kolekcją książek.**

Każda planowana funkcja powinna mieć jasne uzasadnienie w procesie handlowym: pozwalać szybciej znaleźć potencjalnie rentowną ofertę, poprawniej wycenić książkę, ograniczyć koszt lub ryzyko zakupu, sprawniej prowadzić zapasy przeznaczone na sprzedaż albo skuteczniej sprzedać towar.

## Aktualny priorytet (od 2026-11-07)

Właściciel projektu nie handluje w tej chwili. Rozwój koncentruje się na **skanerze, katalogu i weryfikacji**: pokrycie i niezawodność źródeł, struktura dzieł/wydań/serii oraz szybkość i trafność rozpoznawania książek. Funkcje stricte handlowe (ocena okazji, zysk, rejestr transakcji, alerty zakupowe) są odłożone do czasu zmiany tej decyzji.

## Główne procesy

1. **Sourcing:** przeszukiwanie marketplace'ów, wykrywanie nowych ofert, filtrowanie szumu, zapisywanie kryteriów poszukiwania i obserwacja cen.
2. **Weryfikacja towaru:** rozpoznawanie ISBN, tytułu, tomu, wydania, języka, stanu i zawartości zestawu tylko w zakresie potrzebnym do ustalenia, *co jest sprzedawane i ile może być warte*.
3. **Decyzja zakupowa:** cena ogłoszenia, dostawa, prowizje, inne koszty, przewidywana cena odsprzedaży, marża, ROI i margines na ryzyko.
4. **Obsługa handlu:** lista okazji i kandydatów do zakupu, decyzje kupione/odrzucone, koszt nabycia, towary dostępne do odsprzedaży, historia transakcji i wynik finansowy (jako możliwe przyszłe moduły).
5. **Kontrola jakości:** wiarygodność danych ofertowych, aktualność i dostępność ogłoszeń, duplikaty, pomyłki identyfikacji, bezpieczne backupy i diagnostyka.

## Czego świadomie nie rozwijamy

- Inwentarza prywatnej biblioteczki, półek, osobistych zbiorów i „posiadam/chcę mieć” jako celu samego w sobie.
- List brakujących tomów przygotowywanych dla kolekcjonera, kompletowania serii do własnego użytku i rankingów kompletności kolekcji.
- Funkcji czytelniczych: postęp czytania, recenzje, oceny lektur, rekomendacje do czytania, biblioteczka życzeń.
- Kolekcjonerskich osiągnięć, odznak i personalizacji niezwiązanej z wynikami handlowymi.

**Ważne rozróżnienie:** katalog książek, serie, tomy, wydania, ISBN i zestawy pozostają potrzebne jako **model identyfikacji i wyceny towaru**. Nie usuwamy tych danych ani istniejących ekranów tylko dlatego, że używają słowa „katalog”. Rozwijamy je pod kątem szybszego i trafniejszego handlu, a nie gromadzenia kolekcji.

## Priorytety rozwoju

1. **P0/P1:** trafność wyników skanowania, jakość dopasowania książek i wydań, wiarygodne ceny/dostępność, bezpieczne i wydajne pobieranie danych.
2. **P1/P2:** opłacalność *całkowita* — zakup + wysyłka + prowizje + inne koszty vs. realistyczna cena sprzedaży; jasne obliczanie zysku, marży i ROI.
3. **P2:** operacyjna lista ofert do zakupu, statusy transakcyjne, koszt nabycia oraz marża na sprzedanym towarze.
4. **P2/P3:** alerty o spadkach cen, nowych rentownych ofertach i powtarzalne skanowanie zgodne z ograniczeniami serwisów.
5. **Później:** raporty handlowe, rotacja zapasów, koszty i rentowność źródeł; wyłącznie wtedy, gdy istnieją sprawdzone dane do tych obliczeń.

## Jak oceniać propozycję nowej funkcji

Przed rozpoczęciem pracy odpowiedzieć na pytania:

- Jaką decyzję handlową ułatwia funkcja i jaki błąd lub koszt ogranicza?
- Skąd biorą się ceny, koszty i informacje o stanie towaru; co jest potwierdzone, a co szacowane?
- Czy pozwoli mierzyć trafność ofert, zysk netto, czas znalezienia okazji albo rotację towaru?
- Czy wymaga dodatkowych zapytań do marketplace'ów, migracji lub zwiększa ryzyko utraty danych?
- Czy jej głównym beneficjentem jest handlarz, czy kolekcjoner? W drugim przypadku **odrzucamy ją albo przeformułowujemy pod handel**.

## Konsekwencje dla dokumentacji i interfejsu

- „Katalog” oznacza katalog identyfikacyjny książek i ofert handlowych, **nie prywatny księgozbiór**.
- „Zestawy”, „Serie” i „Wydania” służą poprawnemu rozpoznaniu, porównaniu wartości i wystawianiu towaru.
- „Lista obserwowanych” służy ocenie kandydatów do zakupu i ceny docelowej, a nie kompletowaniu własnej kolekcji.
- W planach, issue, PR-ach i dokumentach nie proponować domyślnie funkcji kolekcjonerskich ani rozbudowy biblioteczki.

Ta decyzja jest nadrzędną zasadą zakresu produktu; przyszłe zmiany wymagające odejścia od niej powinny być świadomą, osobno uzasadnioną decyzją produktową.
