# BookFlip Scanner

Prywatny wykonawca kolejki BookFlip. Strona steruje kolejką i trwale zapisuje wyniki. GitHub Actions rozpoczyna skan około 17. minuty każdej godziny, wykonuje recovery około 47. minuty i wznawia istniejącą kolejkę co 5 minut. Osobny worker dopasowywania działa co 5 minut; GitHub może opóźnić harmonogram. Uruchomienie ręczne jest dostępne w Actions → BookFlip Scanner → Run workflow. Nie jest potrzebna rozmowa z ChatGPT.

## Dostęp

Workflow ma contents:read, id-token:write oraz actions:write do zlecania kontynuacji, bez zapisów do kodu repozytorium. BookFlip sprawdza podpis OIDC, dokładne ID repozytorium i właściciela, main, ścieżkę workflow, rodzaj zdarzenia, czas ważności oraz audience. Pull requesty, forki i inne workflow nie mają dostępu. Prywatna brama Sites wymaga dodatkowo sekretu repozytorium BOOKFLIP_SITES_ACCESS z tokenem dostępu serwisowego tej konkretnej strony. Nie zapisuj go w plikach ani zmiennych workflow. Repozytorium nie zawiera kolekcji, historii użytkownika ani kluczy.

## Źródła

Na polecenie właściciela przeniesiono czytniki HTML Vinted, Allegro Lokalnie i OLX z `karno13/nextjs-boilerplate/archiwum-scanner/runtime/scanner.mjs` do osobnego `reference-parsers.mjs`. Skopiowano pięć funkcji rozpoznawania danych, bez transportu Vercel, katalogu, kolekcji, tokenów ani konfiguracji Archiwum. Matcher BookFlip obsługuje Discovery i tytuły Watchlist, w tym Warcraft. Czytnik OLX wymaga rozpoznanej struktury JSON-LD `offers.offers`; zmiana struktury jest błędem, a nie pustym sukcesem.

Transport jest osobny: stałe domeny, maksymalnie 20 kandydatów w pojedynczym zapisie, 18 sekund na odczyt, limit 4 MB, co najmniej 2 sekundy między żądaniami danego źródła. HTTP 429 wstrzymuje całe źródło zgodnie z Retry-After i narastającym opóźnieniem. HTTP 403 bez rozpoznanej strony weryfikacji ponawiamy maksymalnie 5 razy: po 1, 2, 4, 8 i 15 minutach (lub później, gdy wymaga tego Retry-After). Udany zapis partii zeruje licznik. Zachowujemy checkpoint strony i partii. CAPTCHA i wyczerpanie prób 403 zatrzymują źródło; harmonogram pomija je do ręcznego uruchomienia. Nie ma proxy, zmiany adresów IP, sesji logowania ani obchodzenia mechanizmów ochrony. Awaria nie dezaktywuje istniejących ofert.

Vinted ma stronicowanie: nowy skan zaczyna od strony 1, a kolejne przebiegi wznawiają tę samą kolejkę ze strony i partii zapisanej w D1. Limit 20 dotyczy pojedynczej transakcji importu, a nie całej strony ani zapytania. Cała rozpoznana strona jest przetwarzana partiami. Dopiero ostatnia partia zatwierdza przejście do kolejnej strony. Postęp i oferty zapisują się atomowo; powtórzenie checkpointu nie powiela zapisu. Numer następnej strony wynika z metadanych lub poprawnego linku Vinted, nigdy z samej liczby wyników. Powtórzona strona i nierozpoznana paginacja kończą etap z oznaczeniem niepełnego zakresu. Znana ostatnia strona ma osobny status. Nowe zadania Allegro Lokalnie i OLX również zapisują całą rozpoznaną stronę partiami i podążają za potwierdzonym linkiem następnej strony tego samego zapytania. Brak rozpoznanej paginacji kończy skan z niepełnym zakresem; blokady 403/CAPTCHA pozostają respektowane. Stare zadania bez wersji paginacji zachowują limit 20.

Między stronami kolejka ustępuje innym zapytaniom. Próby po błędzie liczone są dla bieżącej strony. Budżet jednego przebiegu GitHub pozostaje ograniczony; niekompletna strona zachowuje zapisany offset, a wykonawca oddaje rezerwację przed zakończeniem. Po awarii odzyskiwana jest wygasła rezerwacja. Zmieniona strona jest czytana ponownie od początku z deduplikacją. Fingerprint ostatnich 100 stron zapobiega pętli; walidacja dopuszcza numery stron 1–10000. Zmiany kolejności ofert w portalu mogą powodować pominięcia i duplikaty, dlatego przejście wszystkich dostępnych stron nie jest gwarancją pełnego pokrycia rynku.

Wyniki HTML mają `provenance=marketplace_html`, cenę w groszach i `availability=unconfirmed`. Cena na liście wyników nie potwierdza dostępności ani ceny szczegółowej. Do wyceny potrzebne są ręczna kontrola oferty i pełne koszty. Nie podłączono głównego Allegro — adapter dotyczy Allegro Lokalnie, jak w Archiwum.

Podłączono publiczny kanał RSS/Atom Sprzedajemy.pl, udostępniony przez wydawcę na stronach wyszukiwania. Wykonawca odczytuje wyłącznie kanał, bez pobierania stron ogłoszeń. Importuje maksymalnie 20 pasujących wpisów z kategorii Książki i Podręczniki, odrzuca figurki i gry komputerowe. Cena jest ceną z kanału, a dostępność pozostaje niepotwierdzona. Data odczytu kanału i data aktualizacji wpisu są oddzielne. Pusty poprawny kanał oznacza brak pasujących wpisów w tym zakresie, nie brak ofert w całym serwisie.

Każdy przebieg tworzy kolejny skan Discovery oraz Watchlist, jeżeli poprzednia kolejka została zakończona. Harmonogram można wstrzymać i wznowić na stronie. Wstrzymanie anuluje oczekujące zadania; ręczne skany są nadal dostępne.

W BookFlip → Źródła i skanery edytuj źródło, wybierz „Dopuszczony feed JSON”, podaj publiczny URL HTTPS feedu bez sekretów i potwierdź uprawnienie do automatycznego odczytu. Feed to tablica lub {"offers":[...]}; rekord: {"title":"...","url":"https://...konkretna-oferta...","price":4500,"active":true,"observedAt":"2026-10-21T20:00:00Z"}. Kwoty: grosze PLN. Rekordy muszą być aktualne (24h), aktywne i pasować do tematu zadania. Dostęp do feedu nie potwierdza wydania ani pełnych kosztów nabycia.

Opcjonalny autoryzowany feed JSON zastępuje czytnik HTML danego portalu. DNS i adresy feedu są walidowane i przypinane; brak przekierowań, limit 1 MB, 15 sekund.

## Koszty i limity

Pętla skanera i workera ma budżet 4 minut. Limity jobów wynoszą odpowiednio 10 i 6 minut. Dwa joby co 5 minut oraz kontynuacje zwiększają zużycie Actions; sprawdzaj rzeczywiste użycie i limity konta.

Etapy zakończone są zapisywane atomowo. Po błędach przejściowych obowiązuje backoff i maksymalnie 3 próby. Odmowa dostępu zatrzymuje etap. Błąd nie usuwa istniejących ofert. W logach są wyłącznie statusy i liczniki.

## Separate matching worker

`.github/workflows/bookflip-scan.yml` defines both jobs in
`PJASDEM/bookflip-scanner`. The scan and the matching worker use separate
job concurrency groups. The matching job also runs every five minutes, consumes
only `status` and `process`, and drains successive batches of up to ten offers for up to
four minutes. It never waits for marketplace HTTP or scans new pages. Empty,
paused, or retry-delayed queues exit without a busy loop. Unfinished work remains
in D1 for the next scheduled run; matching has no continuation-generation limit.
The schedule can be delayed by GitHub. Both jobs retain the existing OIDC trust
boundary and Sites access secret. `process.mjs` needs no GitHub write token.

JSON przekazuje wyłącznie walidowane pola bibliograficzne, w tym ISBN10/13, listę ISBN, autorów, opis, OCR i niepewność odczytu. Nie przekazuje pól decyzji ani kolejki. Nowe zadania przetwarzają cały odczytany dokument (maks. 1000 wpisów) partiami po 3, bez automatycznego podążania za zewnętrznymi URL feedów. Kwoty pozostają PLN; jawne inne waluty są pomijane. Fingerprint strony obejmuje kolejność ofert.


Audyt po PR #5, wyniki regresji i ograniczenia weryfikacji backendu: [AUDIT-2026-10-25.md](AUDIT-2026-10-25.md).
