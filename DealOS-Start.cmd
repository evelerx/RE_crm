@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Deal Intelligence OS - Start (double-click)
REM Starts backend + frontend and opens the app.

cd /d "%~dp0"

set "BACKEND_PORT=8000"
set "FRONTEND_PORT=5173"
set "BACKEND_HEALTH=http://localhost:%BACKEND_PORT%/health"
set "FRONTEND_URL=http://localhost:%FRONTEND_PORT%/"

echo.
echo ==========================================
echo   Deal Intelligence OS - Starting...
echo ==========================================
echo.

call "%~dp0DealOS-Stop.cmd" /quiet >nul 2>&1

REM Start backend + frontend in separate windows
start "DealOS Backend" cmd /k ""%~dp0backend\\run_backend.cmd""
start "DealOS Frontend" cmd /k ""%~dp0frontend\\run_frontend.cmd""

echo Waiting for backend: %BACKEND_HEALTH%
set "BACKEND_OK=0"
for /L %%i in (1,1,240) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%BACKEND_HEALTH%'; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){ exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1 && goto :backend_ok
  timeout /t 1 /nobreak >nul
)
:backend_fail
echo.
echo ERROR: Backend did not become ready on port %BACKEND_PORT%.
echo Check the "DealOS Backend" window for errors.
echo.
pause
exit /b 1

:backend_ok
set "BACKEND_OK=1"

echo Waiting for frontend: %FRONTEND_URL%
set "FRONTEND_OK=0"
for /L %%i in (1,1,240) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%FRONTEND_URL%'; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){ exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1 && goto :frontend_ok
  timeout /t 1 /nobreak >nul
)
:frontend_fail
echo.
echo ERROR: Frontend did not become ready on port %FRONTEND_PORT%.
echo Check the "DealOS Frontend" window for errors.
echo Tip: If you see "port in use", close old Vite windows or run DealOS-Stop.cmd.
echo.
pause
exit /b 1

:frontend_ok
set "FRONTEND_OK=1"

echo Opening: %FRONTEND_URL%
REM More reliable than `start` on some Windows setups
rundll32 url.dll,FileProtocolHandler "%FRONTEND_URL%" >nul 2>&1
if errorlevel 1 start "" "%FRONTEND_URL%"

echo.
echo App: %FRONTEND_URL%
echo Backend: http://localhost:%BACKEND_PORT%
echo.
echo If using phone on same Wi-Fi:
echo   Frontend: http://YOUR_PC_IP:%FRONTEND_PORT%
echo   Backend:  http://YOUR_PC_IP:%BACKEND_PORT%
echo.
pause
