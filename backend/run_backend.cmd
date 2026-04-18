@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo Using backend\.env (preferred) or backend\env (legacy) if present.

if not exist ".venv\\Scripts\\python.exe" (
  echo Creating venv in backend\.venv ...
  python -m venv .venv
)

echo Installing backend dependencies (safe to re-run)...
".venv\\Scripts\\python.exe" -m pip install --disable-pip-version-check --upgrade pip >nul
".venv\\Scripts\\python.exe" -m pip install --disable-pip-version-check -r requirements.txt

echo Ensuring data directory exists...
if not exist "data" mkdir data

echo Running database migrations...
".venv\\Scripts\\python.exe" -m alembic -c alembic.ini upgrade head

echo Starting backend on http://localhost:8000 ...
".venv\\Scripts\\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
