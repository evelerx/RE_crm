@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Deal Intelligence OS - Stop helper (double-click)
REM Kills dev servers listening on default ports.
REM Pass /quiet to suppress output.

set "QUIET=0"
if /I "%~1"=="/quiet" set "QUIET=1"

call :kill_port 8000
call :kill_port 5173

if "%QUIET%"=="0" (
  echo Done.
  pause
)
exit /b 0

:kill_port
set "PORT=%~1"
for /L %%i in (1,1,10) do (
  set "FOUND=0"
  for /f "tokens=5" %%A in ('netstat -aon ^| findstr /R /C:":%PORT% .*LISTENING"') do (
    set "FOUND=1"
    if "%QUIET%"=="0" echo Killing PID %%A on port %PORT%
    taskkill /PID %%A /F >nul 2>&1
  )
  if "!FOUND!"=="0" goto :done_wait
  timeout /t 1 /nobreak >nul
)
:done_wait
exit /b 0
