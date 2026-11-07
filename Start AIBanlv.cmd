@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0demos\web-desktop-pet\harness-client-plugin\run.ps1" -Source
