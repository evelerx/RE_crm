# Deal Intelligence OS (MVP)

This repo contains a minimal **Deal Intelligence OS** MVP:

- `backend/`: FastAPI + SQLite (Deals / Contacts / Activities + AI stubs + per-email data)
- `frontend/`: Responsive React PWA (Pipeline / Grid / Deal detail / ROI)

## One-click start (Windows)

Double-click:
- `DealOS-Start.cmd`
- `DealOS-Stop.cmd` (if ports are stuck/in use)

It opens 2 terminal windows (backend + frontend) and then opens `http://localhost:5173`.

If you want to use the app from your phone on the same Wi-Fi, you may need to allow Windows Firewall:
- Run `setup_firewall_windows.cmd` as Administrator (one time).

## Run (local)

### Backend

1. Copy `backend/env.example` -> `backend/env` (or `backend/.env`) (optional: set `API_KEY`, `JWT_SECRET`, `ADMIN_EMAIL`)
2. In PowerShell:
   - `cd backend`
   - `pip install -r requirements.txt`
   - run `run_backend.cmd`

Backend runs on `http://localhost:8000`.

### Login (email -> token)

- Open the frontend and sign up / sign in using email + password.
- Data is stored **per email** in `backend/data/dealios.db` and will still be there when you log in again with the same email.

### Frontend

1. Copy `frontend/.env.example` -> `frontend/.env` (optional: set `VITE_API_KEY`)
2. In PowerShell (repo root):
   - run `frontend/run_frontend.cmd`

Frontend runs on `http://localhost:5173`.

## Admin portal

Single admin only:

1. Set your admin credentials in `backend/env` (or `backend/.env`):
   - `ADMIN_EMAIL="you@example.com"`
   - `ADMIN_PASSWORD="123Nihar"` (or set `ADMIN_PASSWORD_HASH` instead)
2. Log in with that email+password and you'll be redirected to `/admin`.

## Safe upgrades (no user data loss)

This project now includes **Alembic migrations** in `backend/alembic/`.

- New database (recommended flow):
  - `cd backend`
  - `pip install -r requirements.txt`
  - `alembic -c alembic.ini upgrade head`
  - start backend normally
- Existing database (already created by running the app before):
  - keep using it at `backend/data/dealios.db`
  - when you add new migrations later, run:
    - `cd backend`
    - `alembic -c alembic.ini upgrade head`

Rule for big updates: deploy code that is backward compatible first, then run migrations, then deploy code that uses new columns/tables.

## Database location

- Current DB: `backend/data/dealios.db`
- If you have older `dealios.db` files in other folders, the backend will try a best-effort copy into `backend/data/` on startup.

## iOS usage

On the same Wi-Fi, open `http://YOUR_PC_IP:5173` in Safari -> Share -> **Add to Home Screen** (best-effort PWA).

## Share as a “download”

You can send this project as a ZIP, but phones (iOS/Android) cannot “run the backend” from a downloaded ZIP.
For real users on any device, the practical approach is:

1) **Host the backend** (API + database) on a server
2) **Host the frontend** as a web/PWA
3) Send users a **link**; they can install it from the browser (Home Screen / Install App)

### Docker package (Windows/Mac/Linux computers)

If someone has Docker Desktop installed, they can run everything with:
- `docker compose up --build`

Frontend: `http://localhost:5173`  
Backend: `http://localhost:8000`

## AI (BYO key, stored on device)

- Open `Settings` -> paste your OpenRouter API key + model -> `Test AI`.
- If a key is set, the Deal Detail page follow-up `Generate` uses the LLM; otherwise it uses the free rule-based generator.

## Security notes (important)

- This app blocks scraping/hacking by requiring authentication for APIs, but **no system can guarantee “no hacker ever”**.
- For better protection of sensitive fields (RERA/GSTIN/PAN), set `DATA_ENCRYPTION_KEY` in `backend/.env` (Fernet key).
  - Generate one (PowerShell): `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
  - Then set: `DATA_ENCRYPTION_KEY="..."` and restart backend.
- Use a strong `JWT_SECRET` and keep `backend/.env` private.
