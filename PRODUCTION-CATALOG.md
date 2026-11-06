# BookFlip — produkcyjny katalog SQLite

## Obowiązujący przepływ

Lokalny serwer `local-app.mjs` zapisuje udane skany **bezpośrednio do SQLite**:

1. Zapis oferty i obserwacji ceny.
2. Zapis dowodów ISBN oraz zadania w `identification_jobs`.
3. Przetwarzanie kolejki poza transakcją zapisu skanu, z ograniczoną równoległością i limitami dostawców.
4. Zapis wydania albo skierowanie do weryfikacji, jeśli dowody są niejednoznaczne.

Nie ma produkcyjnego dual-write do `local-offer-history.json`. Historyczne narzędzia JSON są osobne. Nie trzeba korzystać z GitHub Actions do skanowania.

## Lokalizacja danych

Identyfikacja sprawdza najpierw lokalny katalog ISBN, następnie Bibliotekę Narodową. Open Library jest używana wyłącznie po odpowiedzi BN `not_found`. Awaria lub nieprawidłowa odpowiedź BN nie oznacza braku książki. Wyszukiwanie ISBN po tytule również korzysta najpierw z BN, a przy braku kandydatów z Open Library. Różnice między dostawcami nie blokują identyfikacji; przypisanie sprawdza wyłącznie ISBN, bez porównywania tytułu, autora, wydawcy, języka ani innych metadanych oferty. Nieprawidłowy ISBN i niejednoznaczne rekordy nadal wymagają wyjaśnienia.

Domyślnie Windows: `%LOCALAPPDATA%\BookFlip\data\bookflip-catalog.sqlite`. Można nadpisać przez `BOOKFLIP_CATALOG_DB`. W nowej instalacji stary katalog `scan-results` **nie jest automatycznie importowany**.

Przed uruchomieniem niezaaplikowanych migracji istniejącej bazy wykonywany jest backup z kontrolą integralności. Kopie w `data/backups/` nie zastępują kopii poza urządzeniem. Nie zmieniaj ani nie usuwaj istniejących plików `migrations/*.sql` — ich sumy są zapisane w bazie.

## Konfiguracja

| Zmienna | Działanie |
| --- | --- |
| `BOOKFLIP_CATALOG_DB` | Jawna ścieżka bazy |
| `BOOKFLIP_CATALOG_ENABLED=0` | Wyłączenie katalogu |
| `BOOKFLIP_CATALOG_AUTO_RESOLVE=0` | Wyłączenie automatycznej identyfikacji |
| `BOOKFLIP_CATALOG_BATCH` | Liczba zadań w partii (domyślnie 25, maksymalnie 1000) |
| `BOOKFLIP_IDENTIFICATION_POLL_MS` | Odstęp sprawdzania bezczynnej kolejki (domyślnie 5000 ms); gotowe partie są przetwarzane bez tej przerwy |
| `BOOKFLIP_OPEN_LIBRARY_CONTACT` | Kontakt podawany przy żądaniach do Open Library |
| `BOOKFLIP_METADATA_TIMEOUT_MS` | Timeout zewnętrznych metadanych |
| `BOOKFLIP_CATALOG_LEASE_MS`, `BOOKFLIP_CATALOG_RETRY_MS` | Lease i opóźnienie ponowień |
| `BOOKFLIP_LOCAL_PORT` | Port lokalnego serwera (domyślnie 4317) |

## Zasady integralności

- Identyfikacja nie przypisuje oferty automatycznie na podstawie samego podobieństwa tytułu.
- Po obsłużeniu partii automat od razu przechodzi do następnej, jeśli istnieją gotowe zadania. Pauza i zatrzymanie są respektowane pomiędzy partiami, a obsługa HTTP otrzymuje czas procesora.
- Równoczesne zapytania o ten sam ISBN (także odpowiednik ISBN-10/13) współdzielą pobranie. Dane dzieł i autorów Open Library są dodatkowo przechowywane do godziny w ograniczonej pamięci procesu. Błędy nie są utrwalane w tym cache.
- Limity zapytań do każdego dostawcy pozostają zachowane i są wspólne dla wyszukiwania po ISBN i po tytule. Nie przyspieszamy identyfikacji przez pomijanie kontroli konfliktów.
- Pasek pokazuje udział zadań obsłużonych przez automat. `review_required` oznacza oczekiwanie na decyzję użytkownika, a nie trwającą pracę automatyczną; błąd zakończonego zadania również nie jest prezentowany jako aktywna kolejka.
- Dokładny ISBN może pozwolić powiązać wydanie pomimo nieistotnych różnic zapisu tytułu; sprzeczne dowody mogą wymagać decyzji ręcznej.
- Ręczne przypisania i zestawy są chronione przed ponownym automatycznym przypisaniem do pojedynczej książki.
- Zestaw ma własny zapis powiązań do wielu wydań; cena nadal dotyczy całej oferty.
- `GET /api/catalog/status` zwraca liczniki i diagnostykę kolejki; w Ustawieniach dostępne jest ręczne ponowienie identyfikacji.

## Diagnostyka i testy

Log serwera: `%LOCALAPPDATA%\BookFlip\data\local-app.log`. Uruchom `npm test`, `npm run lint` i `npm run check:syntax`. CI sprawdza backend na Windows/Linux oraz podstawowy start interfejsu w Chromium. Te testy nie gwarantują, że zewnętrzny portal aktualnie pozwala na skanowanie.
