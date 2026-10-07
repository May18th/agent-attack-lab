"""Optional OpenAI-compatible chat backend used by the standalone ACP agents."""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import httpx


class LLMError(RuntimeError):
    """The configured model could not return a valid response."""


logger = logging.getLogger("agent_attack_lab.llm")


def is_configured() -> bool:
    return all(os.getenv(name, "").strip() for name in (
        "AGENT_LLM_BASE_URL", "AGENT_LLM_API_KEY", "AGENT_LLM_MODEL"
    ))


def _endpoint() -> str:
    base_url = os.getenv("AGENT_LLM_BASE_URL", "").strip().rstrip("/")
    if base_url.endswith("/chat/completions"):
        return base_url
    return f"{base_url}/chat/completions"


async def complete_json(
    system_prompt: str,
    user_payload: dict[str, Any],
    response_schema: dict[str, Any],
) -> dict[str, Any]:
    if not is_configured():
        raise LLMError("model is not configured")

    body = {
        "model": os.environ["AGENT_LLM_MODEL"].strip(),
        "temperature": 0.2,
        "max_tokens": int(os.getenv("AGENT_LLM_MAX_TOKENS", "1800")),
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "agent_response", "strict": True, "schema": response_schema},
        },
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
    }
    try:
        timeout = httpx.Timeout(float(os.getenv("AGENT_LLM_TIMEOUT_SECONDS", "10")))
        retries = min(max(int(os.getenv("AGENT_LLM_RETRIES", "1")), 0), 2)
        body["max_tokens"] = min(max(int(body["max_tokens"]), 100), 8192)
    except ValueError:
        raise LLMError("invalid model timeout, retry count, or token limit") from None
    result: Any = None
    for attempt in range(retries + 1):
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                response = await client.post(
                    _endpoint(),
                    headers={
                        "Authorization": f"Bearer {os.environ['AGENT_LLM_API_KEY'].strip()}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
            result = json.loads(content)
            logger.info("model_call_completed duration_ms=%d attempt=%d", int((time.perf_counter() - started) * 1000), attempt + 1)
            break
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            logger.warning(
                "model_call_failed duration_ms=%d attempt=%d error=%s",
                int((time.perf_counter() - started) * 1000),
                attempt + 1,
                type(exc).__name__,
            )
            retryable = not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code >= 500
            if attempt >= retries or not retryable:
                raise LLMError(f"model request failed ({type(exc).__name__})") from None
    if not isinstance(result, dict):
        raise LLMError("model response is not a JSON object")
    return result
