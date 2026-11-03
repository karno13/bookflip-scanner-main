# BookFlip na telefonie przez prywatną sieć Tailscale

BookFlip **pozostaje programem uruchomionym na Twoim komputerze**; telefon otwiera jego interfejs przez prywatny adres HTTPS. Nie instalujemy bazy SQLite na telefonie, nie wystawiamy portu 4317 na routerze i nie korzystamy z publicznego `tailscale funnel`.

## Co jest potrzebne

1. Komputer Windows z działającym BookFlip i Node.js 22.16+ lub 24 LTS.
2. Tailscale zainstalowany na komputerze i na telefonie (Android lub iPhone).
3. **To samo konto Tailscale** na komputerze i telefonie; oba urządzenia podłączone do tego samego tailnetu. Włącz MagicDNS.
4. W Tailscale włączone HTTPS certificates i uprawnienie do Tailscale Serve, jeśli instalator poprosi o zgodę.
5. Komputer włączony, połączony z internetem, niewchodzący w uśpienie podczas używania z telefonu.

## Uruchomienie na Windows — zalecana metoda

1. Zainstaluj Tailscale ze strony https://tailscale.com/download i zaloguj się na obu urządzeniach.
2. **Zamknij dotychczasowy serwer BookFlip** (okno, w którym działa `node local-app.mjs`). Samo zamknięcie karty przeglądarki nie zatrzymuje serwera.
3. W folderze projektu uruchom **`Uruchom BookFlip przez Tailscale.cmd`**. Jeśli Tailscale wymaga uprawnień administratora, uruchom terminal Windows jako administrator i stamtąd ten plik.
4. Skrypt pobierze z lokalnego klienta Tailscale nazwę MagicDNS komputera i login jego właściciela; automatycznie ustawi ochronę BookFlip oraz uruchomi `tailscale serve --bg 4317`. Jeżeli tailnet wymaga zgody na HTTPS/Serve, wykonaj wskazaną przez Tailscale konfigurację i uruchom ponownie.
5. Na telefonie włącz aplikację Tailscale i w przeglądarce otwórz **dokładny adres wyświetlony przez skrypt**, na przykład `https://bookflip-pc.example-tailnet.ts.net/` (to przykład, nie Twój adres).
6. Możesz dodać stronę do ekranu głównego telefonu przez opcję przeglądarki „Dodaj do ekranu początkowego”.

Nie potrzebujesz stałego publicznego IP, VPN na routerze ani przekierowania portów.

## Kontrola konfiguracji i wyłączenie

Na komputerze:

```powershell
tailscale status
tailscale serve status
```

Aby wyłączyć udostępnianie BookFlip w Tailscale:

```powershell
tailscale serve --https=443 off
```

Jeśli Twoja konfiguracja Serve ma inne usługi, sprawdź `tailscale serve status`, zanim użyjesz `tailscale serve reset`. Wyłączenie Serve nie usuwa bazy BookFlip. Samo zamknięcie terminala BookFlip zatrzymuje aplikację, ale może nie wyłączyć konfiguracji Serve uruchomionej z `--bg`.

## Dlaczego nie wystarczy uruchomić serwera na adresie 0.0.0.0?

BookFlip ma API umożliwiające zapis danych i rozpoczęcie skanów. Nie posiada zwykłego logowania hasłem. Bezpośrednie udostępnienie portu całej sieci LAN lub internetowi byłoby niepotrzebnym ryzykiem.

W trybie Tailscale:

- BookFlip **nadal nasłuchuje wyłącznie na `127.0.0.1:4317`**;
- proxy Tailscale Serve zapewnia prywatny HTTPS i dostęp zgodnie z regułami Twojego tailnetu;
- serwer akceptuje tylko dokładną nazwę urządzenia w domenie `.ts.net` i **tożsamość właściciela** przekazaną przez Serve w nagłówku `Tailscale-User-Login`;
- żądania zapisujące dane muszą mieć zgodny `Origin: https://<dokładna nazwa urządzenia>` i `Content-Type: application/json`;
- publiczny **Tailscale Funnel nie jest obsługiwany** — nie przekazuje wymaganego nagłówka tożsamości;
- zwykłe lokalne `http://127.0.0.1:4317` nadal działa.

Tailscale zapewnia uwierzytelnienie w Twojej prywatnej sieci, ale **nie jest osobnym kontem BookFlip ani rolami uprawnień do książek**. Nie udostępniaj swojego konta Tailscale innym osobom i sprawdzaj reguły ACL/grants w panelu Tailscale. Na urządzeniu lokalnym proces z prawami użytkownika może podszyć się pod nagłówki proxy; dlatego nie traktuj tego trybu jako bezpiecznego dla współdzielonego, niezaufanego komputera.

## Tryb ręczny (bez pliku CMD)

Jeśli wolisz uruchamiać program ręcznie, znajdź dokładną nazwę maszyny i swój login w `tailscale status --json` i w **tym samym** terminalu PowerShell:

```powershell
$env:BOOKFLIP_TAILSCALE_HOST = 'bookflip-pc.example-tailnet.ts.net'
$env:BOOKFLIP_TAILSCALE_USER = 'twoj-login@example.com'
tailscale serve --bg 4317
node local-app.mjs --no-open
```

Zastąp oba przykłady swoimi rzeczywistymi danymi. Nie zapisuj tokenów ani kluczy Tailscale w repozytorium. Ustawienie tylko jednej zmiennej środowiskowej jest odrzucane przez BookFlip.

## Jeśli telefon nie może otworzyć strony

- Sprawdź, czy Tailscale pokazuje **Connected** na obu urządzeniach i czy działa internet.
- Użyj adresu **HTTPS** z komunikatu skryptu, a nie `http://127.0.0.1:4317` (to adres komputera).
- Sprawdź, czy komputer nie zasnął oraz czy okno serwera BookFlip nadal działa.
- `tailscale serve status` powinno wskazywać proxy do `http://127.0.0.1:4317`.
- Błąd `INVALID_HOST`: sprawdź nazwę MagicDNS, login konta, czy działa **Serve, a nie Funnel**, oraz czy BookFlip uruchomiono przez nowy skrypt.
- Błąd `INVALID_ORIGIN`: otwórz stronę z jej bezpośredniego, dokładnego adresu HTTPS, nie z aliasu lub HTTP.
- Jeżeli strona działa, ale zapis kończy się `403`, sprawdź adres w przeglądarce i uruchom ponownie aplikację skryptem Tailscale.
- Jeśli masz więcej niż jedno konto Tailscale, telefon musi być zalogowany jako właściciel komputera; inny użytkownik będzie odrzucany nawet jeśli widzi komputer w tailnecie.

Oficjalna dokumentacja: https://tailscale.com/docs/features/tailscale-serve oraz https://tailscale.com/docs/reference/tailscale-cli/serve .
