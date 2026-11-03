# Configures private HTTPS via Tailscale Serve and runs BookFlip on localhost.
# No router/firewall change, Funnel, shared credentials, or public listener.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$tailscale = (Get-Command tailscale.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $tailscale) {
  $candidate = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if (Test-Path $candidate) { $tailscale = $candidate }
}
if (-not $tailscale) { throw 'Brak Tailscale. Zainstaluj Tailscale na komputerze i zaloguj sie.' }
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  throw 'Brak Node.js. Zainstaluj Node.js 24 LTS.'
}
$version = (& node -p 'process.versions.node').Trim().Split('.')
if (-not (([int]$version[0] -eq 22 -and [int]$version[1] -ge 16) -or [int]$version[0] -ge 24)) {
  throw 'BookFlip wymaga Node.js 22.16+ lub 24+. Zalecany Node.js 24 LTS.'
}
$statusText = & $tailscale status --json
if ($LASTEXITCODE -ne 0) { throw 'Tailscale nie jest polaczony. Uruchom Tailscale i zaloguj sie.' }
$status = $statusText | ConvertFrom-Json
if ($status.BackendState -ne 'Running') { throw 'Tailscale musi byc aktywny na komputerze.' }
$dns = ([string]$status.Self.DNSName).TrimEnd('.').ToLowerInvariant()
$userId = [string]$status.Self.UserID
$account = $status.User.PSObject.Properties[$userId].Value
$login = [string]$account.LoginName
if ($dns -notmatch '^[a-z0-9-]+\.[a-z0-9.-]+\.ts\.net$' -or -not $login) {
  throw 'Brak nazwy MagicDNS lub konta Tailscale. Sprawdz status konta i wlacz MagicDNS.'
}

$running = $false
try {
  $probe = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4317/api/sources' -TimeoutSec 2
  $running = $probe.StatusCode -eq 200
} catch {}
if ($running) {
  throw 'BookFlip juz dziala. Zamknij stary serwer (Ctrl+C), a potem ponownie uruchom ten plik.'
}

$env:BOOKFLIP_LOCAL_PORT = '4317'
$env:BOOKFLIP_TAILSCALE_HOST = $dns
$env:BOOKFLIP_TAILSCALE_USER = $login
Write-Host ('Tailscale Serve: https://' + $dns + '/')
Write-Host ('Dozwolone konto Tailscale: ' + $login)
Write-Host 'Udostepnianie tylko w prywatnej sieci Tailscale. Nigdy nie uzywaj tailscale funnel.'
& $tailscale serve --bg 4317
if ($LASTEXITCODE -ne 0) { throw 'Nie mozna wlaczyc Tailscale Serve. Sprawdz komunikat Tailscale oraz uprawnienia administratora.' }
Write-Host 'Otworz podany adres HTTPS w przegladarce telefonu z wlaczonym Tailscale.'
Write-Host 'Serwer BookFlip pozostaje na 127.0.0.1:4317; pozostaw to okno otwarte.'
& node local-app.mjs --no-open
if ($LASTEXITCODE -ne 0) { throw 'BookFlip zakonczyl prace z bledem.' }
