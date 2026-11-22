"""Private Supabase Storage adapter for customer document files."""
from __future__ import annotations

from urllib.parse import quote

import httpx
from fastapi import HTTPException

from ..settings import settings


def storage_configured() -> bool:
    return bool((settings.supabase_url or "").strip() and (settings.supabase_service_role_key or "").strip())


def _headers(content_type: str | None = None) -> dict[str, str]:
    if not storage_configured():
        raise HTTPException(status_code=503, detail="Secure document storage is not configured yet. Contact Northstone support.")
    key = settings.supabase_service_role_key.strip()
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _object_url(path: str) -> str:
    base = settings.supabase_url.strip().rstrip("/")
    bucket = quote(settings.supabase_documents_bucket.strip(), safe="")
    return f"{base}/storage/v1/object/{bucket}/{quote(path, safe='/')}"


def upload_document(path: str, content: bytes, content_type: str) -> None:
    response = httpx.post(_object_url(path), headers=_headers(content_type), content=content, timeout=45)
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail="Secure document upload failed. Please try again.")


def download_document(path: str) -> tuple[bytes, str]:
    response = httpx.get(_object_url(path), headers=_headers(), timeout=45)
    if response.status_code >= 300:
        raise HTTPException(status_code=404, detail="Document file is not available")
    return response.content, response.headers.get("content-type", "application/octet-stream")


def delete_document(path: str) -> None:
    response = httpx.delete(_object_url(path), headers=_headers(), timeout=30)
    if response.status_code not in {200, 204, 404}:
        raise HTTPException(status_code=502, detail="Could not remove document from secure storage")
