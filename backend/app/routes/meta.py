from fastapi import APIRouter


router = APIRouter()


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/config")
def config():
    return {
        "stages": ["lead", "visit", "negotiation", "closed", "lost"],
        "asset_types": ["residential", "commercial", "land", "industrial", "other"],
        "activity_kinds": ["whatsapp", "call", "meeting", "site_visit", "email", "other"],
    }

