@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Nie znaleziono Node.js. Zainstaluj Node.js i uruchom ten plik ponownie.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number); process.exit((v[0]===22 && v[1]>=16) || v[0]>=24 ? 0 : 1)"
if errorlevel 1 (
  echo BookFlip wymaga Node.js 22.16+ lub 24+. Zalecany Node.js 24 LTS.
  pause
  exit /b 1
)
powershell.exe -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4317/api/sources' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  start "" "http://127.0.0.1:4317"
  exit /b 0
)
node local-app.mjs
if errorlevel 1 pause
