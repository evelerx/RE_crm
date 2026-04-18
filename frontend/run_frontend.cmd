@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo Installing frontend dependencies (safe to re-run)...
call cmd /c npm install

echo Starting frontend on http://localhost:5173 ...
REM strictPort prevents silent port switching (DealOS-Start expects 5173)
call cmd /c npm run dev
