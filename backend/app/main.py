import logging
import os
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .db import init_db

logger = logging.getLogger(__name__)
from .routes import (
    activities,
    admin,
    admin_marketing,
    agency_auth,
    agency_executive,
    agency_manager,
    ai,
    auth,
    contacts,
    csvio,
    deals,
    enterprise,
    integrations,
    insights,
    llm,
    meta,
    marketing,
    next_actions,
    profile,
    public,
    whatsapp,
)
from . import runtime_state
from .settings import settings


def _allowed_origins() -> list[str]:
    origins = {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "https://northstonecrm.com",
        "https://www.northstonecrm.com",
        "https://app.northstonecrm.com",
    }
    for candidate in (settings.frontend_origin, settings.public_app_url):
        candidate = (candidate or "").strip().rstrip("/")
        if candidate:
            origins.add(candidate)
    return sorted(origins)


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not settings.api_key:
        return
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")


app = FastAPI(title=settings.app_name)
uploads_dir = Path(__file__).resolve().parents[1] / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(?::(4173|5173))?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    try:
        response: Response = await call_next(request)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Unhandled API error while processing %s %s", request.method, request.url.path)
        response = JSONResponse(
            status_code=500,
            content={"detail": "Internal server error. Check backend logs for the failing route."},
        )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.on_event("startup")
def _startup():
    if settings.jwt_secret == "change-me":
        logger.warning(
            "SECURITY: JWT_SECRET is using the insecure default 'change-me'. "
            "Set a strong random JWT_SECRET in backend/.env before deploying."
        )
    try:
        init_db()
        runtime_state.startup_error = None
    except Exception as exc:
        runtime_state.startup_error = str(exc)
        logger.exception("Startup database initialization failed; API will stay up for diagnostics.")


app.include_router(meta.router)
app.include_router(public.router)
app.include_router(auth.router)
app.include_router(integrations.router)

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
app.include_router(whatsapp.router, dependencies=deps)
app.include_router(marketing.router, dependencies=deps)
app.include_router(marketing.payments_router, dependencies=deps)
app.include_router(admin_marketing.router, dependencies=deps)
app.include_router(agency_auth.router, dependencies=deps)
app.include_router(agency_manager.router, dependencies=deps)
app.include_router(agency_executive.router, dependencies=deps)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


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
