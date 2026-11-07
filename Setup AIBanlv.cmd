@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0demos\web-desktop-pet\scripts\setup-source.ps1"
if errorlevel 1 (
  echo AIBanlv setup failed. Review the error above.
  pause
  exit /b 1
)
pause
