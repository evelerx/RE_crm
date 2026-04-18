# Vercel Environment Variables

Use two separate Vercel projects:

- `backend/` as the FastAPI API project
- `frontend/` as the React/Vite app project

## Backend project env vars

Set these in the Vercel project whose root directory is `backend/`.

```env
APP_NAME=Deal Intelligence OS
API_KEY=
JWT_SECRET=replace-with-a-long-random-secret
DATABASE_URL=postgresql+psycopg://postgres.your-project-ref:your-password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require
FRONTEND_ORIGIN=https://your-frontend-project.vercel.app

ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=
ADMIN_PASSWORD_HASH=replace-with-a-real-hash

PBKDF2_ROUNDS=60000
DATA_ENCRYPTION_KEY=replace-with-your-fernet-key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
JWT_EXP_DAYS=30
```

### Backend notes

- Prefer `ADMIN_PASSWORD_HASH` over `ADMIN_PASSWORD`
- `API_KEY` can stay blank unless you intentionally want an extra shared API header
- `DATA_ENCRYPTION_KEY` is required if you want encrypted AI key storage
- `FRONTEND_ORIGIN` must exactly match your deployed frontend domain
- `DATABASE_URL` should use the Supabase **pooler** connection string

## Frontend project env vars

Set these in the Vercel project whose root directory is `frontend/`.

```env
VITE_API_BASE_URL=https://your-backend-project.vercel.app
VITE_API_KEY=
```

### Frontend notes

- `VITE_API_BASE_URL` should be the deployed backend URL
- Leave `VITE_API_KEY` blank unless backend `API_KEY` is also set

## Supabase setup order

1. Create the Supabase project
2. Run [init.sql](/c:/Users/nihar/OneDrive/Desktop/new%20re%20CRM/backend/supabase/init.sql) in the Supabase SQL editor
3. Copy the pooler connection string into backend `DATABASE_URL`
4. Deploy the backend Vercel project
5. Deploy the frontend Vercel project

