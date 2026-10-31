> Archiwum: dawny README opisujący projekt kolejki GitHub Actions i Sites. Nie opisuje obecnej lokalnej aplikacji BookFlip.

# BookFlip Scanner

Prywatny wykonawca kolejki BookFlip. Strona steruje kolejką i trwale zapisuje wyniki. GitHub Actions rozpoczyna skan około 17. minuty każdej godziny, wykonuje recovery około 47. minuty i wznawia istniejącą kolejkę co 5 minut. Osobny worker dopasowywania działa co 5 minut; GitHub może opóźnić harmonogram. Uruchomienie ręczne jest dostępne w Actions → BookFlip Scanner → Run workflow. Nie jest potrzebna rozmowa z ChatGPT.

## Dostęp

Workflow ma contents:read, id-token:write oraz actions:write do zlecania kontynuacji, bez zapisów do kodu repozytorium. BookFlip sprawdza podpis OIDC, dokładne ID repozytorium i właściciela, main, ścieżkę workflow, rodzaj zdarzenia, czas ważności oraz audience. Pull requesty, forki i inne workflow nie mają dostępu. Prywatna brama Sites wymaga dodatkowo sekretu repozytorium BOOKFLIP_SITES_ACCESS z tokenem dostępu serwisowego tej konkretnej strony. Nie zapisuj go w plikach ani zmiennych workflow. Repozytorium nie zawiera kolekcji, historii użytkownika ani kluczy.

## Źródła

Na polecenie właściciela przeniesiono czytniki HTML Vinted, Allegro Lokalnie i OLX z `karno13/nextjs-boilerplate/archiwum-scanner/runtime/scanner.mjs` do osobnego `reference-parsers.mjs`. Skopiowano pięć funkcji rozpoznawania danych, bez transportu Vercel, katalogu, kolekcji, tokenów ani konfiguracji Archiwum. Matcher BookFlip obsługuje Discovery i tytuły Watchlist, w tym Warcraft. Czytnik OLX wymaga rozpoznanej struktury JSON-LD `offers.offers`; zmiana struktury jest błędem, a nie pustym sukcesem.

Transport jest osobny: stałe domeny, maksymalnie 20 kandydatów w pojedynczym zapisie, 18 sekund na odczyt, limit 4 MB, co najmniej 2 sekundy między żądaniami danego źródła. HTTP 429, 408, 425 i 5xx wstrzymują źródło zgodnie z ograniczonym `Retry-After` i mechanizmem ponawiania trwałej kolejki. Niejednoznaczny HTTP 403 również jest przekazywany do kolejki jako błąd przejściowy. Rozpoznana CAPTCHA lub strona weryfikacji zatrzymuje źródło bez automatycznego ponawiania. Zachowujemy checkpoint strony i partii. Nie ma proxy, zmiany adresów IP, sesji logowania ani obchodzenia mechanizmów ochrony. Awaria nie dezaktywuje istniejących ofert. Log diagnostyczny zawiera nazwę źródła, kod, status HTTP, rodzaj błędu i czas ponowienia, bez HTML, parametrów wyszukiwania i danych uwierzytelniających.

Vinted ma stronicowanie: nowy skan zaczyna od strony 1, a kolejne przebiegi wznawiają tę samą kolejkę ze strony i partii zapisanej w D1. Limit 20 dotyczy pojedynczej transakcji importu, a nie całej strony ani zapytania. Cała rozpoznana strona jest przetwarzana partiami. Dopiero ostatnia partia zatwierdza przejście do kolejnej strony. Postęp i oferty zapisują się atomowo; powtórzenie checkpointu nie powiela zapisu. Numer następnej strony wynika z metadanych lub poprawnego linku Vinted, nigdy z samej liczby wyników. Powtórzona strona i nierozpoznana paginacja kończą etap z oznaczeniem niepełnego zakresu. Znana ostatnia strona ma osobny status. Nowe zadania Allegro Lokalnie i OLX również zapisują całą rozpoznaną stronę partiami i podążają za potwierdzonym linkiem następnej strony tego samego zapytania. Brak rozpoznanej paginacji kończy skan z niepełnym zakresem; blokady 403/CAPTCHA pozostają respektowane. Stare zadania bez wersji paginacji zachowują limit 20.

Między stronami kolejka ustępuje innym zapytaniom. Próby po błędzie liczone są dla bieżącej strony. Budżet jednego przebiegu GitHub pozostaje ograniczony; niekompletna strona zachowuje zapisany offset, a wykonawca oddaje rezerwację przed zakończeniem. Po awarii odzyskiwana jest wygasła rezerwacja. Zmieniona strona jest czytana ponownie od początku z deduplikacją. Fingerprint ostatnich 100 stron zapobiega pętli; walidacja dopuszcza numery stron 1–10000. Zmiany kolejności ofert w portalu mogą powodować pominięcia i duplikaty, dlatego przejście wszystkich dostępnych stron nie jest gwarancją pełnego pokrycia rynku.

Wyniki HTML mają `provenance=marketplace_html`, cenę w groszach i `availability=unconfirmed`. Cena na liście wyników nie potwierdza dostępności ani ceny szczegółowej. Do wyceny potrzebne są ręczna kontrola oferty i pełne koszty.

Empik jest odczytywany z serwerowo renderowanych kart `.search-list-item.ta-product-tile`. Parser wiąże tytuł, adres, identyfikator produktu, bieżącą cenę i walutę w obrębie jednej karty, odrzuca rozbieżne ceny oraz podąża za paginacją po 60 wyników. Pusta rozpoznana lista jest poprawnym wynikiem; nieznany układ strony kończy zadanie błędem zamiast zapisać pusty sukces.

Główne Allegro ma adapter listy ofert, ale zwykłe żądania z lokalnego wykonawcy i GitHub Actions mogą otrzymywać HTTP 403 z weryfikacją DataDome. Taka odpowiedź jest klasyfikowana jako `SOURCE_CAPTCHA` i zatrzymywana bez prób obchodzenia zabezpieczeń. Dopóki Allegro nie udostępni publicznego, dozwolonego kanału bez płatnego API albo nie dopuści tego ruchu, automatyczne ceny z głównego Allegro pozostają niedostępne. Allegro Lokalnie jest osobnym źródłem i zachowuje dotychczasowy parser.

Podłączono publiczny kanał RSS/Atom Sprzedajemy.pl, udostępniony przez wydawcę na stronach wyszukiwania. Wykonawca odczytuje wyłącznie kanał, bez pobierania stron ogłoszeń. Importuje maksymalnie 20 pasujących wpisów z kategorii Książki i Podręczniki, odrzuca figurki i gry komputerowe. Cena jest ceną z kanału, a dostępność pozostaje niepotwierdzona. Data odczytu kanału i data aktualizacji wpisu są oddzielne. Pusty poprawny kanał oznacza brak pasujących wpisów w tym zakresie, nie brak ofert w całym serwisie.

Każdy przebieg tworzy kolejny skan Discovery oraz Watchlist, jeżeli poprzednia kolejka została zakończona. Harmonogram można wstrzymać i wznowić na stronie. Wstrzymanie anuluje oczekujące zadania; ręczne skany są nadal dostępne.

W BookFlip → Źródła i skanery edytuj źródło, wybierz „Dopuszczony feed JSON”, podaj publiczny URL HTTPS feedu bez sekretów i potwierdź uprawnienie do automatycznego odczytu. Feed to tablica lub {"offers":[...]}; rekord: {"title":"...","url":"https://...konkretna-oferta...","price":4500,"active":true,"observedAt":"2026-10-21T20:00:00Z"}. Kwoty: grosze PLN. Rekordy muszą być aktualne (24h), aktywne i pasować do tematu zadania. Dostęp do feedu nie potwierdza wydania ani pełnych kosztów nabycia.

Opcjonalny autoryzowany feed JSON zastępuje czytnik HTML danego portalu. DNS i adresy feedu są walidowane i przypinane; brak przekierowań, limit 1 MB, 15 sekund.

## Koszty i limity

Pętla skanera i workera ma budżet 4 minut. Limity jobów wynoszą odpowiednio 10 i 6 minut. Dwa joby co 5 minut oraz kontynuacje zwiększają zużycie Actions; sprawdzaj rzeczywiste użycie i limity konta.

## Test lokalny źródeł

### Aplikacja lokalna

Najprościej uruchomić aplikację dwuklikiem na pliku `Uruchom BookFlip Scanner.cmd`. Możesz też wpisać w terminalu `node local-app.mjs`. Aplikacja otworzy się pod adresem `http://127.0.0.1:4317`. W oknie wyszukiwania można wpisać do 10 haseł, wybrać zapisane źródła, sortować oferty i wyeksportować wynik do JSON. Filtr jest stały: książki w języku polskim. Dla Vinted aplikacja sprawdza pole języka w metadanych każdej konkretnej oferty i pokazuje wyłącznie `Polski`; oferta bez rozpoznanego języka jest pomijana. Wybrane źródła i hasła są zapisywane lokalnie w przeglądarce. Aplikacja nie korzysta z kolejki ani bazy BookFlip.

Podczas skanu interfejs pokazuje aktywne źródło, hasło, numer strony i licznik ofert. Zdarzenia diagnostyczne są dopisywane do `scan-results/local-app.log`; log zawiera tylko czas, źródło, hasło, stronę, liczby i kody błędów.

Błąd na późniejszej stronie lub podczas sprawdzania szczegółów Vinted nie odrzuca wcześniej zebranych ofert. Taki etap ma status częściowy, a poprawnie odczytane rekordy są zapisywane w historii. Błędy przejściowe, między innymi HTTP 429, 408, 425, 5xx, timeout i zerwane połączenie, są ponawiane maksymalnie trzy razy z ograniczonym opóźnieniem. Rozpoznana CAPTCHA lub jawna blokada dostępu nie jest ponawiana.

Znalezione oferty są zapisywane w `scan-results/local-offer-history.json`. Jest to lokalny magazyn danych aplikacji, podzielony logicznie na minimalny katalog `books`, rekordy `offers` i punkty `priceHistory`. Zapis odbywa się atomowo. Dane z wcześniejszego formatu wersji 1 są migrowane podczas pierwszego odczytu; brak ISBN nie blokuje zapisu oferty. Oferta jest deduplikowana po stabilnym ID źródła, a gdy źródło go nie ujawnia — po znormalizowanym URL. Brak oferty w następnym skanie nie oznacza jej automatycznie jako sprzedanej.

Nowy punkt historii powstaje przy pierwszym wykryciu i każdej zmianie ceny. Ponowne wykrycie tej samej ceny aktualizuje tylko datę ostatniej obserwacji. ISBN jest pobierany z jednoznacznych metadanych źródła i zapisywany wyłącznie po sprawdzeniu sumy kontrolnej. Dla znanych ofert Vinted zapisane metadane języka i ISBN są używane ponownie, bez kolejnego odczytu strony szczegółowej.

Widok „Historia” pokazuje książki powiązane dokładnie po ISBN, bieżące statystyki, historyczne minimum, listę ofert oraz wykres obserwowanych cen. Oferty bez ISBN pozostają niepowiązane. Ocena ceny wymaga co najmniej dwóch innych ofert tego samego ISBN i nie uwzględnia ocenianej oferty w medianie. Progi znajdują się w `price-analysis.mjs`. Historia opisuje ogłoszenia, nie potwierdzone transakcje.

Zakładka „Katalog” jest prostym masterfile książek. Można dodać tytuł z opcjonalnym ISBN i ręcznie przypisać do niego dowolną zapisaną ofertę. Ręczne przypisanie ma pierwszeństwo przed późniejszym automatycznym odczytem ISBN i pozostaje zachowane przy kolejnych skanach. Statystyki oraz historia pozycji katalogowej agregują wszystkie przypisane do niej oferty bez łączenia rekordów po podobieństwie tytułu.

Detektor blokad rozróżnia pasywny skrypt Cloudflare `scripts/jsd/main.js` od strony weryfikacyjnej. Sama obecność tego skryptu nie blokuje parsera. Poprzednie raporty `SOURCE_CAPTCHA` dla Empiku, Vinted i Tezeusza mogły być fałszywymi alarmami. Faktyczne komunikaty weryfikacji, aktywne challenge i blokady DataDome nadal zatrzymują odczyt. Aplikacja lokalna przechodzi po kolejnych stronach, jeśli źródło potwierdzi link `next`, z limitem 50 stron na zapytanie. Narzędzie `local-scan.mjs` pozostaje diagnostyczne i odczytuje jedną wskazaną stronę.

`local-scan.mjs` uruchamia ten sam transport i parser marketplace co kolejka, ale nie korzysta z OIDC, sekretu BookFlip ani endpointu zapisu. Domyślnie odczytuje jedną stronę Empiku dla zapytania Warcraft:

```powershell
node local-scan.mjs
node local-scan.mjs --source Empik --query "Horus Rising"
node local-scan.mjs --source Allegro --query Warcraft
node local-scan.mjs --source all --query Warcraft --examples 3
```

Kod wyjścia `0` oznacza poprawny odczyt wszystkich wybranych źródeł, `2` niedostępność co najmniej jednego źródła, a `1` nieprawidłowe argumenty. Wynik zawiera tylko liczniki, paginację, przykładowe oferty i bezpieczną diagnostykę. Test nie zapisuje niczego do kolejki ani bazy.

Pełna lokalna próba wszystkich adapterów i rodzin wyszukiwania zapisuje częściowe wyniki po każdym żądaniu w ignorowanym przez Git katalogu `scan-results/`:

```powershell
node local-batch-scan.mjs
```

Jeden błąd lub CAPTCHA nie przerywa pozostałych źródeł. Raport zawiera pełne wyniki każdej pary źródło–hasło, bezpieczną diagnostykę oraz skonsolidowaną tablicę `offers`, deduplikowaną po adresie oferty i opisaną polami `source` i `matchedQueries`.

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
