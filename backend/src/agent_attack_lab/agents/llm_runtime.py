"""Optional DeepSeek chat backend used by the standalone ACP agents."""

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
_REQUIRED_CONFIG = ("BASE_URL", "API_KEY", "MODEL")


def _role_prefix(role: str | None) -> str | None:
    if role is None:
        return None
    normalized = role.strip().upper()
    if normalized not in {"ATTACKER", "DEFENDER", "ARBITER", "REPORT", "RULE"}:
        raise LLMError("invalid model role")
    return f"AGENT_{normalized}_LLM_"


def _selected_prefix(role: str | None) -> str:
    role_prefix = _role_prefix(role)
    if role_prefix and any(
        os.getenv(role_prefix + name, "").strip() for name in _REQUIRED_CONFIG
    ):
        return role_prefix
    return "AGENT_LLM_"


def _configured(prefix: str) -> bool:
    return all(os.getenv(prefix + name, "").strip() for name in _REQUIRED_CONFIG)


def _setting(prefix: str, name: str, default: str) -> str:
    value = os.getenv(prefix + name, "").strip()
    if value:
        return value
    if prefix != "AGENT_LLM_":
        value = os.getenv("AGENT_LLM_" + name, "").strip()
    return value or default


def is_configured(role: str | None = None) -> bool:
    """Return whether a shared or optionally role-specific endpoint is complete."""
    return _configured(_selected_prefix(role))


def _endpoint(prefix: str) -> str:
    base_url = os.getenv(prefix + "BASE_URL", "").strip().rstrip("/")
    if base_url.endswith("/chat/completions"):
        return base_url
    return f"{base_url}/chat/completions"


async def complete_json(
    system_prompt: str,
    user_payload: dict[str, Any],
    *,
    role: str | None = None,
) -> dict[str, Any]:
    prefix = _selected_prefix(role)
    if not _configured(prefix):
        raise LLMError("model is not configured")

    body = {
        "model": os.environ[prefix + "MODEL"].strip(),
        "temperature": 0.2,
        "max_tokens": int(_setting(prefix, "MAX_TOKENS", "4000")),
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
    }
    try:
        timeout = httpx.Timeout(float(_setting(prefix, "TIMEOUT_SECONDS", "10")))
        retries = min(max(int(_setting(prefix, "RETRIES", "1")), 0), 2)
        body["max_tokens"] = min(max(int(body["max_tokens"]), 100), 8192)
    except ValueError:
        raise LLMError("invalid model timeout, retry count, or token limit") from None
    result: Any = None
    for attempt in range(retries + 1):
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                response = await client.post(
                    _endpoint(prefix),
                    headers={
                        "Authorization": f"Bearer {os.environ[prefix + 'API_KEY'].strip()}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
            result = json.loads(content)
            logger.info(
                "model_call_completed role=%s duration_ms=%d attempt=%d",
                role or "shared",
                int((time.perf_counter() - started) * 1000),
                attempt + 1,
            )
            break
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            logger.warning(
                "model_call_failed role=%s duration_ms=%d attempt=%d error=%s",
                role or "shared",
                int((time.perf_counter() - started) * 1000),
                attempt + 1,
                type(exc).__name__,
            )
            retryable = (
                not isinstance(exc, httpx.HTTPStatusError)
                or exc.response.status_code >= 500
            )
            if attempt >= retries or not retryable:
                raise LLMError(f"model request failed ({type(exc).__name__})") from None
    if not isinstance(result, dict):
        raise LLMError("model response is not a JSON object")
    return result


async def complete_text(
    system_prompt: str,
    user_text: str,
    *,
    role: str | None = None,
) -> str:
    """Call the configured chat endpoint and return plain text.

    The controlled target must answer like a real service, so it cannot be
    forced into JSON mode the way the agent roles are.
    """
    prefix = _selected_prefix(role)
    if not _configured(prefix):
        raise LLMError("model is not configured")
    body = {
        "model": os.environ[prefix + "MODEL"].strip(),
        "temperature": 0.2,
        "max_tokens": int(_setting(prefix, "MAX_TOKENS", "800")),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
    }
    try:
        timeout = httpx.Timeout(float(_setting(prefix, "TIMEOUT_SECONDS", "20")))
        retries = min(max(int(_setting(prefix, "RETRIES", "1")), 0), 2)
    except ValueError:
        raise LLMError("invalid model timeout or retry count") from None
    for attempt in range(retries + 1):
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                response = await client.post(
                    _endpoint(prefix),
                    headers={
                        "Authorization": f"Bearer {os.environ[prefix + 'API_KEY'].strip()}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise LLMError("model returned an empty reply")
            logger.info(
                "model_text_completed role=%s duration_ms=%d attempt=%d",
                role or "shared",
                int((time.perf_counter() - started) * 1000),
                attempt + 1,
            )
            return content
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            logger.warning(
                "model_text_failed role=%s duration_ms=%d attempt=%d error=%s",
                role or "shared",
                int((time.perf_counter() - started) * 1000),
                attempt + 1,
                type(exc).__name__,
            )
            retryable = (
                not isinstance(exc, httpx.HTTPStatusError)
                or exc.response.status_code >= 500
            )
            if attempt >= retries or not retryable:
                raise LLMError(f"model request failed ({type(exc).__name__})") from None
    raise LLMError("model request failed")
