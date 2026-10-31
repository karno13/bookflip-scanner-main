# Audyt aktualnego main po PR #5 — 2026-10-25

Punkt odniesienia: `61eb9361b69f8afcb2ab995ea105dfd949c5e307`. Main zawiera już poprawki opisane w AUDIT-2026-10-25.md; poniższe ustalenia dotyczą aktualnego kodu, nie przypisują wcześniejszych poprawek temu PR.

## Błędy potwierdzone testami, poprawione w tym PR

- Pusty lub biały tytuł watchlisty JSON pasował do dowolnej oferty. Regresja przed poprawką importowała obcą książkę, po poprawce zwraca pustą listę.
- AbortError i błąd transportu z cause.code=UND_ERR_SOCKET podczas skanowania były klasyfikowane jako blocked. Regresje runnera przed poprawką nie otrzymywały temporary; teraz zachowują możliwość wznowienia i nie zatwierdzają strony. Jawne blocked ma pierwszeństwo.
- Błąd odczytu treści HTTP 403 usuwał informację o statusie i Retry-After. Nowa regresja przed poprawką otrzymywała surowy connection reset. Teraz źródło jest zatrzymywane jako blocked, zachowując 403 i cooldown 600 s. Nieczytelna odpowiedź nie jest uznawana za zgodę na kolejne żądania. CAPTCHA w czytelnej odpowiedzi również zachowuje Retry-After.

## Wyniki przeglądu wymaganych obszarów

1. Workflow ma osobne joby i grupy concurrency dla scan i matching, cancel-in-progress=false. Cron */5 uruchamia oba, scan z resumeOnly=true; :17 inicjuje pracę, :47 służy recovery. Kontynuacje workflow_dispatch uruchamiają scan, nie matching. Repo/main są sprawdzane w obu jobach. OIDC ma id-token:write, checkout nie utrwala poświadczeń. Schedule GitHub jest best effort i nie gwarantuje odstępu pięciu minut. Nie zmieniono harmonogramu ani uprawnień.
2. Timeout opcjonalnych szczegółów Vinted zachowuje trzy oferty bez fikcyjnego ISBN. Test z audit.test.mjs przechodzi. Aktualny main odrzuca 403/429 przed bestEffort; CAPTCHA także przerywa batch. Wcześniejsze partie pozostają zapisane, bieżąca nie przesuwa checkpointu. Kolejna próba zależy od backendu i jego cooldownu.
3. Transport zachowuje ograniczenia hostów, HTTPS, blokadę prywatnych adresów feedu, limit odpowiedzi, odstęp żądań, CAPTCHA i Retry-After. Nie dodano proxy, rotacji tożsamości ani obchodzenia ograniczeń. Zmiany HTML listingów są błędem, nie pozornym sukcesem pustej strony. Nierozpoznane opcjonalne szczegóły ISBN pozostają opisane jako nierozpoznane.
4. Testy obejmują pagination Vinted/OLX/Allegro, wznowienie offsetu, reset digestu, feed 47 ofert w partiach, normalizację URL i ponawianie complete z tym samym requestId. Nowa regresja exhausted symuluje wszystkie trzy niepewne zapisy: brak fail, zachowane requestId, status i raport błędu. Nie dowodzi to idempotencji backendu.
5. Matching jest niezależny od powodzenia skanu i wykonuje tylko status/process. Testy obejmują opróżnianie kolejki, pauzę i brak postępu. Backend musi atomowo zapisywać ofertę, checkpoint i enqueue; bez tego możliwa jest zapisana oferta, która nigdy nie trafi do matching. Worker nie naprawia brakującego enqueue.
6. Testy obejmują sieć, HTML, wznowienia i utratę lease. Testy runnera podstawiają transport i adaptery, nie realną bazę. Nie ma dowodu odporności backendu na SIGKILL po claim lub pomiędzy zapisem a enqueue.

## Potencjalne zagrożenia — niepotwierdzone jako błędy backendu

- Kod backendu jest poza repo: atomowość, globalna deduplikacja, requestId, wygasłe lease, retry matching i kontrakt status.processing wymagają osobnych testów integracyjnych. processing=0 może ukryć osierocone rekordy, jeśli backend błędnie je liczy.
- Opis ponownego sprawdzenia ISBN nie tworzy trwałej kolejki odczytów. Zaimportowana oferta bez ISBN może nigdy nie zostać wzbogacona.
- Digest Vinted opiera się na surowych URL; zmiana filtrowania lub dostępności bez zmiany URL może zmienić zestaw przy zachowaniu digestu. Ruchome listingi między stronami oraz zmiany slugów/aliasów hosta wymagają deduplikacji po ID w backendzie. Nieznana paginacja oznacza niepełne pokrycie; RSS/legacy ograniczają import do 20 ofert.
- Payload jest liczony przed wzbogaceniem, według znaków zamiast bajtów. Bez kontraktu API nie można potwierdzić skutków przekroczenia limitu. Retry i odczyty szczegółów mogą przekroczyć miękki budżet; twarde przerwanie wymaga odzyskiwania lease.
- Ograniczenie Retry-After do 86400 s wymaga zgodności z kontraktem źródeł; nie zweryfikowano produkcyjnych odpowiedzi ani polityk serwisów.

## Walidacja i granice

- Przed zmianami node --test: 7/7 plików. Nowe regresje najpierw zawiodły dla pustej watchlisty, nieczytelnego 403, AbortError i socketu.
- Po zmianach node --test: 8/8 plików; node --check wszystkich plików mjs. Runner recovery: 10 scenariuszy, w tym wyczerpanie retry. Środowisko lokalne Node 24.19.0; CI używa Node 22, którego tutaj nie uruchomiono.
- Oba workflow sparsowane PyYAML BaseLoader; sprawdzono strukturę, crony, rozdział concurrency i macierz warunku matching dla schedule/push/dispatch. actionlint niedostępny; nie deklarujemy pełnej walidacji wyrażeń przez GitHub.
- Bez skanowania produkcyjnego, wywołań backendu, zmian sekretów, dispatch ani automatycznego merge. Testy używają atrap. Nie potwierdzono działania harmonogramu i uprawnień OIDC na produkcji.
