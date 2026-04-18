import os
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .db import init_db
from .routes import (
    activities,
    admin,
    ai,
    auth,
    contacts,
    csvio,
    deals,
    enterprise,
    insights,
    llm,
    meta,
    next_actions,
    profile,
)
from .settings import settings


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not settings.api_key:
        return
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")


app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|\d{1,3}(\.\d{1,3}){3}):5173$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.on_event("startup")
def _startup():
    init_db()


app.include_router(meta.router)
app.include_router(auth.router)

# Protected routers (API key optional, but if set it must match)
deps = [Depends(require_api_key)]
app.include_router(contacts.router, dependencies=deps)
app.include_router(deals.router, dependencies=deps)
app.include_router(activities.router, dependencies=deps)
app.include_router(ai.router, dependencies=deps)
app.include_router(admin.router, dependencies=deps)
app.include_router(profile.router, dependencies=deps)
app.include_router(llm.router, dependencies=deps)
app.include_router(next_actions.router, dependencies=deps)
app.include_router(csvio.router, dependencies=deps)
app.include_router(insights.router, dependencies=deps)
app.include_router(enterprise.router, dependencies=deps)


# Optional: serve built frontend (no separate web server needed).
# Set FRONTEND_DIST to the Vite dist folder path (contains index.html + assets/).
_dist = os.getenv("FRONTEND_DIST", "").strip()
if _dist and Path(_dist).exists():
    dist_dir = Path(_dist).resolve()
    assets_dir = dist_dir / "assets"
    index_html = dist_dir / "index.html"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    if index_html.exists():

        @app.get("/{path:path}", include_in_schema=False)
        def _spa(path: str):  # noqa: ARG001
            return FileResponse(str(index_html))
