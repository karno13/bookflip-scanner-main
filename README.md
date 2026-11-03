# BookFlip — lokalne narzędzie do handlu książkami

BookFlip to lokalna aplikacja na Windows wspierająca handel używanymi książkami: skanowanie ofert, identyfikację towaru, porównywanie cen i decyzje zakupowe, z interfejsem w przeglądarce i bazą SQLite. Główny serwer to `local-app.mjs`. **GitHub Pages jest tylko demonstracją**, nie uruchamia skanów ani nie przechowuje Twojego katalogu.

## Cel produktu i granice rozwoju

**BookFlip służy do handlu książkami, nie do prowadzenia prywatnej kolekcji.** Jego celem jest wyszukiwanie okazji, prawidłowe rozpoznawanie książek i wydań, ocena pełnych kosztów zakupu, potencjalnej ceny odsprzedaży, zysku i ryzyka oraz obsługa ofert i transakcji.

Katalog, ISBN, serie, tomy i zestawy pomagają **identyfikować i wyceniać towar**, a nie kompletować własną biblioteczkę. **Nie planujemy funkcji dla kolekcjonerów** takich jak prywatne półki, brakujące tomy do własnego zbioru, statystyki czytania czy ranking kompletności kolekcji. Propozycje nowych funkcji oceniamy przez ich wartość w procesie zakupu i odsprzedaży.

Zasady podejmowania decyzji produktowych i lista celów poza zakresem: [Kierunek produktu — handel, nie kolekcjonerstwo](docs/PRODUCT-DIRECTION.md).

## Uruchomienie (Windows 11)

1. Zainstaluj Node.js **24 LTS (zalecany)** albo **22.16 lub nowszy z gałęzi 22**. W Node 22 moduł `node:sqlite` pozostaje eksperymentalny; wymagane API kopii SQLite pojawiło się w 22.16. Node 23 nie jest wspierany.
2. Pobierz aktualne repozytorium i rozpakuj je w osobnym folderze aplikacji.
3. Uruchom **`Uruchom BookFlip Scanner.cmd`** (lub `npm start`).
4. Otwórz `http://127.0.0.1:4317`.

Pozostaw serwer uruchomiony, gdy skanujesz lub identyfikujesz książki. Aplikacja domyślnie nasłuchuje **wyłącznie na localhost**; nie udostępniaj portu 4317 bez osobnego, przetestowanego rozwiązania uwierzytelnienia i sieci prywatnej.

## Dostęp do BookFlip z telefonu (Tailscale)

BookFlip można otworzyć z telefonu przez **prywatną sieć Tailscale i Tailscale Serve** (HTTPS, bez publicznego portu, bez Funnel). Na komputerze i telefonie potrzebny jest Tailscale na tym samym koncie; komputer musi być włączony.

Na Windows zamknij stary serwer BookFlip i uruchom **`Uruchom BookFlip przez Tailscale.cmd`**. Skrypt wykryje adres MagicDNS i konto właściciela, uruchomi prywatne proxy `tailscale serve --bg 4317` i lokalny serwer w trybie zgodnym z Tailscale. Na telefonie włącz Tailscale i otwórz wyświetlony adres HTTPS. Działanie lokalne na `127.0.0.1` pozostaje bez zmian.

**Nie stosuj `tailscale funnel`, przekierowania portu ani `0.0.0.0`.** Serwer dopuszcza wyłącznie dokładny host Tailscale Serve i tożsamość właściciela, nadal nasłuchując wyłącznie na localhost. Szczegóły konfiguracji, wyłączania i rozwiązywania problemów: [BookFlip przez Tailscale na telefonie](docs/TAILSCALE.md).

## Sześć obszarów aplikacji

| Zakładka | Funkcja |
| --- | --- |
| Skaner | Wybór źródeł, zapytania, przebieg skanu i oferty |
| Do weryfikacji | Decyzje dotyczące ISBN i wydania, oznaczanie oferty jako zestawu |
| Katalog | Dzieła i wydania, identyfikatory, metadane |
| Zestawy | Jedna oferta z kilkoma wydaniami; cena dotyczy całego zestawu |
| Oferty | Filtry, historia cen i szczegóły zapisanych ogłoszeń |
| Ustawienia | Stan SQLite, diagnostyka identyfikacji, ręczne ponowienie kolejki |

Znajdowanie ISBN w źródłach zewnętrznych nie gwarantuje automatycznego przypisania. Sprzeczne lub słabe dowody nadal kierują ofertę do ręcznej weryfikacji.

## Gdzie są dane?

**Nowa instalacja niczego nie importuje ze starego katalogu programu.**

- Windows: `%LOCALAPPDATA%\BookFlip\data\bookflip-catalog.sqlite`
- Linux: `$XDG_DATA_HOME/BookFlip/data/bookflip-catalog.sqlite` lub `~/.local/share/BookFlip/data/bookflip-catalog.sqlite`
- Plik stanu: `scan-status.json`, a log diagnostyczny: `local-app.log` — w tym samym katalogu danych.
- Zmienna `BOOKFLIP_CATALOG_DB` pozwala świadomie wskazać inną bazę.
- Stary `scan-results/` pozostaje nieużywany przez nowy domyślny magazyn SQLite; jego usunięcie nie jest wymagane i może pozbawić Cię archiwum.

**Aktualizacja:** zamknij BookFlip, wymień tylko pliki programu i uruchom ponownie. Nie usuwaj katalogu `%LOCALAPPDATA%\BookFlip\data`. Przed zmianami struktury istniejącej bazy program wykonuje kopię w podfolderze `backups`. Przed większą aktualizacją zalecana jest dodatkowa kopia na inny dysk.

### Ręczny backup

```powershell
npm run backup
npm run backup -- "D:\\Backups\\bookflip.sqlite"
```

Backup używa API SQLite (uwzględnia WAL), sprawdza integralność i nie nadpisuje istniejącej kopii. Kopia zapasowa na tym samym dysku nie chroni przed awarią dysku.

## Testowanie

```powershell
npm test
npm run lint
npm run check:syntax
```

CI: `.github/workflows/scanner-tests.yml` (testy Node na Linux i Windows) oraz `.github/workflows/browser-smoke.yml` (Chromium, sześć widoków, izolowana niepusta baza testowa). Test przeglądarkowy nie zastępuje pełnego testu skanowania rzeczywistych portali.

## Architektura i dalsza dokumentacja

- `local-app.mjs` — serwer i API; `app/` — interfejs.
- `marketplaces.mjs`, `local-scan.mjs` — źródła skanowania.
- `catalog-production.mjs`, `sqlite-catalog-repository.mjs`, `catalog-api.mjs`, `offer-sets.mjs` — zapis i odczyt katalogu oraz zestawów.
- `catalog-resolver.mjs`, `identification-worker.mjs`, `metadata-sources/` — dopasowanie ISBN i metadane.
- `migrations/` — **niezmienne** migracje SQLite; nie usuwaj starych plików migracji.

Szczegóły: [Katalog i konfiguracja](PRODUCTION-CATALOG.md), [Przechowywanie i migracje](docs/DATA-MIGRATION.md), [Mapa repozytorium](docs/REPOSITORY-MAP.md).

## Co jest historyczne?

Nieaktywny runner GitHub Actions został usunięty, ponieważ nie był wykorzystywany przez lokalny BookFlip. Zachowano odrębnie testowane parsery źródeł i narzędzia importu starej historii JSON, które mogą służyć diagnostyce. Historyczne raporty UI i zrzuty usunięto z bieżącej gałęzi; pozostają w historii Git. Dokument historycznej migracji JSON zachowano w `docs/archive/`.

Nie commituj prawdziwych baz SQLite, historii skanów, cookies, kluczy ani innych danych prywatnych.


## Przywracanie katalogu SQLite

Kopia utworzona poleceniem `npm run backup` zawiera katalog, historię cen,
obserwowane oferty, notatki i serie (oraz profile skanowania w wersjach obsługujących tę funkcję).

1. Zamknij aplikację BookFlip przed przełączaniem plików katalogu.
2. Uruchom `npm run restore -- "ścieżka/do/kopii.sqlite" "ścieżka/do/odzyskanego.sqlite"`.
3. Narzędzie sprawdza integralność i wymagane tabele, a następnie tworzy **nowy** plik.
   Odmawia nadpisania istniejącej bazy, więc oryginał pozostaje nietknięty.
4. Uruchom aplikację ze zmienną `BOOKFLIP_CATALOG_DB` wskazującą odzyskany plik
   i zweryfikuj liczniki oraz przykładowe dane.
5. Dopiero po sprawdzeniu zdecyduj o zastąpieniu starej bazy. Nie podmieniaj pliku
   SQLite, kiedy serwer pracuje.

Kopie warto trzymać także na innym dysku; backup i przywracanie nie oznaczają
automatycznego harmonogramu tworzenia kopii.

## Pomiar wydajności skanowania SQLite (bez internetu)

Uruchom `npm run bench:scan -- --offers 1000`, a następnie
`npm run bench:scan -- --offers 10000`, aby porównać zapis nowych ofert
z ponownym skanem zmieniającym 10% cen. Narzędzie tworzy osobną
**syntetyczną** bazę w katalogu tymczasowym, nie łączy się z marketplace'ami,
nie dotyka prywatnego katalogu i po pomiarze usuwa dane testowe.

Wynik JSON zawiera czas obu operacji w milisekundach, liczbę ofert, zmian cen,
obserwacji cenowych, rozmiar SQLite i RSS. Porównuj wyniki w podobnych warunkach:
systemie, wersji Node i obciążeniu komputera. To nie jest pomiar rzeczywistego
Vinted ani obietnica konkretnej szybkości na sprzęcie użytkownika.
