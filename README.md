# Deal Intelligence OS

This repo contains a minimal **Deal Intelligence OS** MVP:

- `backend/`: FastAPI + SQLModel API
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
- In local mode, data is stored in `backend/data/dealios.db` unless `DATABASE_URL` is set to Postgres.

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

## Production setup: Supabase + Vercel

This project is ready for:

- `Supabase Postgres` for the database
- `Vercel` for the frontend
- `Vercel` for the FastAPI backend as a separate project rooted at `backend/`

### 1. Create the Supabase database

In Supabase:

1. Create a new project
2. Open `Project Settings -> Database`
3. Copy the **pooler** connection string
4. Use the SQLAlchemy/psycopg format in `DATABASE_URL`
5. Run [backend/supabase/init.sql](/c:/Users/nihar/OneDrive/Desktop/new%20re%20CRM/backend/supabase/init.sql) in the Supabase SQL editor

Example:

```env
DATABASE_URL="postgresql+psycopg://postgres.your-project-ref:your-password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require"
```

Supabase recommends pooled connections for hosted apps, and their docs note that application-side poolers like SQLAlchemy are suitable for long-running containers and VMs. For serverless-style deployments, the Supabase pooler connection is the safer default.

### 2. Deploy the backend to Vercel

Create a Vercel project with **Root Directory** set to `backend/`.

Important:

- Vercel supports FastAPI directly when an `app` is exported from `app.py` or `index.py`
- This repo includes `backend/index.py` for that reason

Set these backend environment variables in Vercel:

```env
APP_NAME="Deal Intelligence OS"
JWT_SECRET="your-long-random-secret"
DATABASE_URL="postgresql+psycopg://postgres.your-project-ref:your-password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require"
FRONTEND_ORIGIN="https://your-frontend-project.vercel.app"
ADMIN_EMAIL="you@example.com"
ADMIN_PASSWORD_HASH="..."
DATA_ENCRYPTION_KEY="your-fernet-key"
OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"
```

Optional:

- `API_KEY`
- `ADMIN_PASSWORD` if you are not using `ADMIN_PASSWORD_HASH`

### 3. Deploy the frontend to Vercel

Create a second Vercel project with **Root Directory** set to `frontend/`.

Set:

```env
VITE_API_BASE_URL="https://your-backend-project.vercel.app"
VITE_API_KEY=""
```

The frontend already reads `VITE_API_BASE_URL`, so no code changes are needed during deployment.

For a copy-ready list of both Vercel project env sets, use [docs/VERCEL_ENV.md](/c:/Users/nihar/OneDrive/Desktop/new%20re%20CRM/docs/VERCEL_ENV.md).

### 4. Run the backend once so tables are created

On first backend start, `SQLModel.metadata.create_all(...)` creates the tables automatically in Supabase.

### 5. Move existing local SQLite data into Supabase

Recommended safest path:

1. Keep your current local SQLite DB as the source of truth
2. Start the backend locally against SQLite
3. Export the data you need using the CSV export endpoints or a one-time migration script
4. Start the backend against Supabase
5. Import the data into the new hosted environment

If you want a direct SQLite -> Supabase migration script, that should be done carefully so UUIDs, enterprise ownership, and foreign keys stay intact.

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
