# BookFlip — produkcyjny katalog SQLite

## Obowiązujący przepływ

Lokalny serwer `local-app.mjs` zapisuje udane skany **bezpośrednio do SQLite**:

1. Zapis oferty i obserwacji ceny.
2. Zapis dowodów ISBN oraz zadania w `identification_jobs`.
3. Przetwarzanie kolejki poza transakcją zapisu skanu, z ograniczoną równoległością i limitami dostawców.
4. Zapis wydania albo skierowanie do weryfikacji, jeśli dowody są niejednoznaczne.

Nie ma produkcyjnego dual-write do `local-offer-history.json`. Historyczne narzędzia JSON są osobne. Nie trzeba korzystać z GitHub Actions do skanowania.

## Lokalizacja danych

Domyślnie Windows: `%LOCALAPPDATA%\BookFlip\data\bookflip-catalog.sqlite`. Można nadpisać przez `BOOKFLIP_CATALOG_DB`. W nowej instalacji stary katalog `scan-results` **nie jest automatycznie importowany**.

Przed uruchomieniem niezaaplikowanych migracji istniejącej bazy wykonywany jest backup z kontrolą integralności. Kopie w `data/backups/` nie zastępują kopii poza urządzeniem. Nie zmieniaj ani nie usuwaj istniejących plików `migrations/*.sql` — ich sumy są zapisane w bazie.

## Konfiguracja

| Zmienna | Działanie |
| --- | --- |
| `BOOKFLIP_CATALOG_DB` | Jawna ścieżka bazy |
| `BOOKFLIP_CATALOG_ENABLED=0` | Wyłączenie katalogu |
| `BOOKFLIP_CATALOG_AUTO_RESOLVE=0` | Wyłączenie automatycznej identyfikacji |
| `BOOKFLIP_CATALOG_BATCH` | Liczba zadań w partii (domyślnie 5) |
| `BOOKFLIP_IDENTIFICATION_POLL_MS` | Odstęp sprawdzania kolejki (domyślnie 5000 ms) |
| `BOOKFLIP_OPEN_LIBRARY_CONTACT` | Kontakt podawany przy żądaniach do Open Library |
| `BOOKFLIP_METADATA_TIMEOUT_MS` | Timeout zewnętrznych metadanych |
| `BOOKFLIP_CATALOG_LEASE_MS`, `BOOKFLIP_CATALOG_RETRY_MS` | Lease i opóźnienie ponowień |
| `BOOKFLIP_LOCAL_PORT` | Port lokalnego serwera (domyślnie 4317) |

## Zasady integralności

- Identyfikacja nie przypisuje oferty automatycznie na podstawie samego podobieństwa tytułu.
- Dokładny ISBN może pozwolić powiązać wydanie pomimo nieistotnych różnic zapisu tytułu; sprzeczne dowody mogą wymagać decyzji ręcznej.
- Ręczne przypisania i zestawy są chronione przed ponownym automatycznym przypisaniem do pojedynczej książki.
- Zestaw ma własny zapis powiązań do wielu wydań; cena nadal dotyczy całej oferty.
- `GET /api/catalog/status` zwraca liczniki i diagnostykę kolejki; w Ustawieniach dostępne jest ręczne ponowienie identyfikacji.

## Diagnostyka i testy

Log serwera: `%LOCALAPPDATA%\BookFlip\data\local-app.log`. Uruchom `npm test`, `npm run lint` i `npm run check:syntax`. CI sprawdza backend na Windows/Linux oraz podstawowy start interfejsu w Chromium. Te testy nie gwarantują, że zewnętrzny portal aktualnie pozwala na skanowanie.
