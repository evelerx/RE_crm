from fastapi import APIRouter


router = APIRouter()


@router.get("/health")
def health():
    return {"ok": True}


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
