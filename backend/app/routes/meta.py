from fastapi import APIRouter

from ..db import DATABASE_URL
from .. import runtime_state


router = APIRouter()


@router.get("/health")
def health():
    is_supabase = "pooler.supabase.com" in DATABASE_URL
    return {
        "ok": runtime_state.startup_error is None,
        "startup_error": runtime_state.startup_error,
        "database_backend": "supabase_pooler" if is_supabase else ("sqlite" if DATABASE_URL.startswith("sqlite") else "postgres"),
    }


@router.get("/push/firebase-config")
def push_firebase_config():
    """
    Compatibility endpoint for older cached frontend bundles.
    Push notifications are currently disabled, so return a stable
    non-error payload instead of letting stale clients fail hard.
    """
    return {
        "enabled": False,
        "provider": "disabled",
        "projectId": "",
        "messagingSenderId": "",
        "appId": "",
        "apiKey": "",
        "authDomain": "",
        "storageBucket": "",
        "vapidKey": "",
    }


@router.get("/config")
def config():
    return {
        "stages": ["lead", "visit", "negotiation", "closed", "lost"],
        "asset_types": ["residential", "commercial", "land", "industrial", "other"],
        "activity_kinds": ["whatsapp", "call", "meeting", "site_visit", "email", "other"],
    }
