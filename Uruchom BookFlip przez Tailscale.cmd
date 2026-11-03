@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-tailscale.ps1"
if errorlevel 1 (
  echo.
  echo Konfiguracja Tailscale lub BookFlip nie powiodla sie. Sprawdz komunikat powyzej.
  pause
)
