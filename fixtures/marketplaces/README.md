# Fixtures parserów serwisów ogłoszeniowych

Pliki `*.json` są odczytywane przez `marketplace-fixtures.test.mjs`. Testy działają offline, bez pobierania danych z serwisów.

## Pochodzenie

- `kind: "synthetic"` — zbudowany ręcznie przykład struktury HTML/JSON-LD. **Nie jest dowodem, że parser nadal działa na aktualnej stronie serwisu.**
- `kind: "captured"` — fragment faktycznej strony z datą `capturedAt`, po ręcznej kontroli i anonimizacji `reviewedForPersonalData: true`.

Obecne przykłady strukturalne OLX i Allegro Lokalnie są **syntetyczne**. W repozytorium nie ma jeszcze zweryfikowanych aktualnych przechwyceń HTML Vinted, OLX i Allegro. Nie można rzetelnie oznaczyć ich jako autentyczne bez dostępu do prawdziwego fragmentu strony.

## Dodawanie autentycznej próbki

1. Zapisz prywatnie HTML **publicznego wyniku wyszukiwania**, do którego masz uprawniony dostęp. Nie obchodź CAPTCHA ani mechanizmów autoryzacji i nie zapisuj ciasteczek logowania.
2. Ręcznie wytnij tylko fragment rozpoznawany przez odpowiedni parser (np. JSON-LD produktu lub właściwy wpis RSC). Nie kopiuj całego dokumentu, trackerów ani kodu analitycznego.
3. Usuń nazwy użytkowników, adresy e-mail, tokeny, identyfikatory sesji, adresy prywatne, numery telefonów i inne dane osób. Nazwy i ceny ofert można zastąpić danymi przykładowymi, zachowując istotny kształt pól.
4. Umieść w tym folderze plik JSON z `kind: "captured"`, `source`, `host`, `capturedAt`, `sanitized: true`, `reviewedForPersonalData: true`, `searchQuery`, `category`, `html` i `expected` (tablica `{url,price}`).
5. Uruchom `npm test` i przejrzyj diff przed commitem. Ogranicz pojedynczy fragment HTML do 300 KB.

Nie przechowuj tutaj nieoczyszczonych plików ani prywatnych zapisów stron. Testy nie potwierdzają autentyczności metadanych; dokumentuje ją osoba przygotowująca próbkę.
