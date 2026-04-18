from __future__ import annotations

from ..settings import settings


class OpenRouterError(RuntimeError):
    pass


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
        "X-Title": "Deal Intelligence OS",
    }
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.4,
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(url, headers=headers, json=payload)
    except Exception as e:
        raise OpenRouterError(f"Failed to reach OpenRouter: {e}") from e

    if res.status_code >= 400:
        raise OpenRouterError(f"OpenRouter error {res.status_code}: {res.text}")

    data = res.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        raise OpenRouterError("Unexpected OpenRouter response") from e
