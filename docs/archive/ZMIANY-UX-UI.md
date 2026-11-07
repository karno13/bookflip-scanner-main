# Przebudowa UX i UI BookFlip

Zmiany dotyczą sześciu zakładek i wspólnej nawigacji. Zachowano lokalny model aplikacji, istniejące dane i historyczne migracje. Nowa migracja `104_trading_workflow.sql` dodaje dane handlowe; przy otwarciu starszej bazy jest objęta mechanizmem backupu przed migracją.

## Skaner

- Formularz wyszukiwania poprzedza zarządzanie profilami. Profile są rozwijane; osobno zapisuje się nowy profil i aktualizuje wybrany. Utworzenie profilu nie nadpisuje istniejącej nazwy, również przy równoczesnym zapisie z innej karty. Usunięcie profilu można cofnąć w bieżącej sesji.
- Nadmiar ponad 10 fraz powoduje komunikat zamiast cichego obcinania.
- Główny wynik pokazuje liczbę ofert i zadań z problemami. Przyciski otwierają wyniki konkretnego skanu, nowe oferty, zmiany cen i jego kolejkę weryfikacji.
- Powtórzenie problematycznych zadań zachowuje dokładne pary źródło/fraza. Nie dodaje innych kombinacji.
- Diagnostyka źródeł i zdarzenia są schowane w rozwinięciu. Globalne wyniki identyfikacji przeniesiono do Ustawień.
- Podgląd ostatnich ofert pobiera własne wyniki z bazy, niezależnie od filtrów zakładki Oferty. Szczegóły działają ze Skanera i pozostałych ekranów.
- Pulpit na dole pokazuje operacyjne liczniki całej bazy: weryfikacja, obserwowane i osiągnięty próg ceny. Usunięto licznik starych lokalnych serii.

## Do weryfikacji

- „Znajdź wydanie” robi podgląd zgodności z ofertą. Nie zapisuje przypisania ani nie kończy zadania. Zapis wymaga osobnego „Zatwierdź wydanie”; ponownie sprawdzana jest zgodność danych.
- Sprawdzenia dodatkowe są rozwijane. Powód weryfikacji i porównanie metadanych są widoczne przy decyzji; statusy mają polskie nazwy.
- Dostępne są „Pomiń na teraz”, przywrócenie pominiętych i dodanie brakującego rekordu bez opuszczania zadania.
- Wybór wydania obsługuje strzałki i Escape. Skróty nawigacji nie przechwytują wpisywania w formularzach.
- Kolejka pokazuje zadania wymagające decyzji. Można zawęzić ją do konkretnego skanu lub oferty.
- Historia ostatnich ręcznych decyzji pozwala ponownie otworzyć pozycję do korekty. Poprzednie wpisy są niezmienne. Nowsza decyzja, nowsze przypisanie, zestaw lub trwające zadanie blokują niebezpieczną korektę.

## Katalog

- Usunięto narrację prywatnej biblioteki. Katalog służy identyfikacji towaru i porównywaniu wydań.
- Sortowanie po aktualizacji działa w bazie; kolejność i filtrowanie nie są nadpisywane lokalnym sortowaniem części wyników.
- Dodano filtry języka, wydawcy, roku i oprawy. Brak wyników filtrów ma inny komunikat niż pusta baza.
- Dane dzieła i wydania można poprawić w szczegółach. Wydania tego samego dzieła można porównać wraz z ISBN.
- Duplikaty dzieł można połączyć po podglądzie liczby przenoszonych wydań i potwierdzeniu. Zachowywane są wydania, oferty, historia decyzji i stare odnośniki. Konflikty serii i chronionych starych identyfikatorów blokują operację bez częściowych zmian. Nie wykonuje się automatycznego łączenia samych wydań na podstawie tytułu.
- Powiązane oferty otwierają wspólny panel szczegółów. Dane zawierają ostatnie wykrycie i informację o niepotwierdzonej dostępności. Statystyki cen wydania nie mieszają jawnie niedostępnych ofert ani obcych walut z PLN.
- Globalne podsumowanie brakujących tomów usunięto z głównego widoku. Dane serii pozostają przy dziele; import starszych oznaczeń przeniesiono do Ustawień.

## Zestawy

- Widoczna jest cena całego pakietu. Liczniki rozróżniają fizyczne egzemplarze i rozpoznane pozycje.
- Pozycja ma ilość i własne założenie ceny odsprzedaży za sztukę. W wyborze wydania widoczne są ISBN, wydawca, rok, język i oprawa.
- Można zapisać nierozpoznane książki z ilością. Nie pozwalają one potwierdzić pełnego składu. Zmiana składu unieważnia wcześniejsze potwierdzenie.
- Zestaw ma zapisany scenariusz kosztów i odsprzedaży oraz faktyczną cenę zakupu. Sumę cen składników można świadomie zastosować do scenariusza; nie zastępuje ona potwierdzonej ceny sprzedaży.
- Dostępne są szczegóły oferty i odnośnik do ogłoszenia. Dodawanie wydania wymaga wyboru zestawu.

## Oferty

- Widoki: Wszystkie, Obserwowane, Próg osiągnięty, Do sprawdzenia, Negocjowane, Kupione, Odrzucone. Filtry działają w całej bazie przed stronicowaniem.
- Dodano filtr konkretnego skanu, rodzaju zmiany w skanie i zakresu ceny. Nowe powiązania skan/oferta są zapisywane od migracji 104; starszych powiązań nie odtwarza się przez zgadywanie z daty ostatniego wykrycia.
- Jedno stronicowanie po 25 ofert zastępuje równoległe strony lokalne i ręczne pobieranie partii. Automatyczne odświeżanie tła nie resetuje listy. Ręczne odświeżanie i zapis notatek zachowują numer strony, z korektą po zmianie liczby wyników.
- Status zakupowy jest widoczny na liście. Szczegóły prowadzą przez decyzję, koszty i porównania do historii.
- Scenariusz i faktyczna cena zakupu zapisują się w bazie. Domyślne koszty są tylko propozycją dla nowych scenariuszy. Puste koszty nie są automatycznie uznawane za zero.
- Obserwowanie, status, cena docelowa i notatka zapisują się tym samym przyciskiem. Błąd odczytu notatek nie otwiera pustego formularza do nadpisania danych.
- Panel działa poza ukrytymi zakładkami. Obsługuje fokus, Escape, powrót do elementu otwierającego i ostrzeżenie o niezapisanych zmianach. Historia ma pojedyncze rozwinięcie zamiast rozwinięcia w rozwinięciu.

## Ustawienia i wspólne UI

- Pokazywana jest lokalizacja danych, ostatnia lokalna kopia i kopiowanie ścieżki. Przycisk tworzy nowy backup sprawdzany przez SQLite; nie nadpisuje wcześniejszych plików. Ekran zawiera instrukcję bezpiecznego odtwarzania do nowego pliku.
- Ustawienia zapisują domyślne koszty dostawy i inne koszty. Importy starszych notatek, profili i serii są zebrane w jednym miejscu.
- Źródła odróżniają dostępność adaptera od wyniku pobrania; pokazują datę ostatniego sukcesu i błędu. Grupa ponawianej identyfikacji ma informację o przybliżonej liczebności i zakresie działania.
- Na telefonie pozostaje pięć głównych przycisków; Katalog i Ustawienia otwiera „Więcej”. Powiększono małe teksty oraz pola i cele dotykowe. Zachowano istniejącą paletę i układ aplikacji.
- Ostrzeżenie o niezapisanych zmianach pozwala zachować formularz albo przywrócić ostatnio zapisane wartości. Aktualizacje starszego, zamkniętego formularza nie czyszczą stanu nowego formularza.

## Weryfikacja i ograniczenia

Lokalnie zaliczono **388/388 testów Node**, obejmujących integrację nowych API i zapis/odczyt po ponownym otwarciu bazy. Kontrola składni objęła **180 modułów JavaScript**. Sprawdzono też zbilansowanie tagów HTML, unikalność identyfikatorów i umieszczenie wspólnego panelu poza ukrytymi widokami. Test Chromium został dostosowany do nowych interakcji, w tym ręcznego zapisu obserwowania, zapisu scenariusza, rozwijanych profili i menu mobilnego.

Nie wykonano lokalnego smoke Chromium ani wizualnej oceny na telefonie: dostęp do przeglądarki był zablokowany, a w folderze nie ma Playwright. Lint i Prettier wymagają nieobecnych zależności developerskich. To ograniczenie weryfikacji, a nie potwierdzenie poprawnego wyglądu każdej rozdzielczości. Nie uruchamiano rzeczywistych skanów portali ani migracji prywatnej bazy użytkownika.
