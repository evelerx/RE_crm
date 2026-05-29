from __future__ import annotations

from typing import Any

from ..settings import settings


class OpenRouterError(RuntimeError):
    pass


def _extract_text_content(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                if item.strip():
                    parts.append(item.strip())
                continue
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
                    continue
                if item.get("type") == "output_text":
                    nested = item.get("content")
                    extracted = _extract_text_content(nested)
                    if extracted:
                        parts.append(extracted)
        return "\n".join(part for part in parts if part).strip()
    if isinstance(value, dict):
        for key in ("text", "content", "message"):
            extracted = _extract_text_content(value.get(key))
            if extracted:
                return extracted
    return ""


async def chat_completion(*, api_key: str, model: str, messages: list[dict], max_tokens: int = 200) -> str:
    try:
        import httpx  # type: ignore
    except Exception as e:  # pragma: no cover
        raise OpenRouterError(
            "LLM dependencies not installed (missing httpx). Restart backend to install requirements."
        ) from e

    url = f"{settings.openrouter_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        # Optional but recommended by OpenRouter:
        "HTTP-Referer": "http://localhost",
        "X-Title": "Northstone",
    }
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.4,
    }

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.post(url, headers=headers, json=payload)
    except Exception as e:
        raise OpenRouterError(f"Failed to reach OpenRouter: {e}") from e

    if res.status_code >= 400:
        raise OpenRouterError(f"OpenRouter error {res.status_code}: {res.text}")

    data = res.json()
    try:
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            first_choice = choices[0]
            if isinstance(first_choice, dict):
                message = first_choice.get("message")
                text = _extract_text_content(message)
                if text:
                    return text
                text = _extract_text_content(first_choice.get("text"))
                if text:
                    return text
        output_text = _extract_text_content(data.get("output_text"))
        if output_text:
            return output_text
    except Exception as e:
        raise OpenRouterError("Unexpected OpenRouter response") from e
    raise OpenRouterError(f"Unexpected OpenRouter response: {str(data)[:400]}")
