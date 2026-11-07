@echo off
setlocal DisableDelayedExpansion
set "PET_CONTROL_WS_URL=ws://127.0.0.1:6372/ws/control"
set "PET_CONTROL_HTTP_ORIGIN=http://127.0.0.1:6372"
set "PET_DEVICE_USER_DATA=%LOCALAPPDATA%\AIBanlv\local-service"
call "%~dp0Start AIBanlv.cmd"
