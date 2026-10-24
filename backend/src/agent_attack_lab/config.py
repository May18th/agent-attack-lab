"""Process configuration resolved from the environment at import time.

Every value is still read exactly once at startup, same as when it lived inside
``service.py``. The only change for callers is how they read it: use
``config.<name>`` at call time instead of importing the name directly, because
tests and operators switch behaviour by patching the module attribute.

Don't write ``from .config import api_key`` anywhere -- that alias binds the
value at import time, so a later ``monkeypatch.setattr(config, "api_key", ...)``
would be silently ignored and the test would pass while testing nothing.

The validation ``RuntimeError`` raises below are part of the contract: a
misconfigured deployment must fail at startup, not at the first request. Their
relative order is preserved from the original module.
"""

from __future__ import annotations

import os
from pathlib import Path

# --- Service metadata -------------------------------------------------------
# Read by the FastAPI app factory and by /health, which must report the same
# version the OpenAPI document advertises.
service_version = "1.0.0"

# --- CORS -------------------------------------------------------------------

_default_origins = {
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://yuanyiagentzhandui.cn",
}
_configured_origins = {
    origin.strip()
    for origin in os.getenv("AGENT_CORS_ORIGINS", "").split(",")
    if origin.strip()
}
cors_origins = _configured_origins or _default_origins
cors_origin_regex = os.getenv(
    "AGENT_CORS_ORIGIN_REGEX",
    r"^https://[a-z0-9-]+\.trycloudflare\.com$",
)

# --- Cloudflare Access ------------------------------------------------------

cloudflare_access_team_domain = (
    os.getenv("CF_ACCESS_TEAM_DOMAIN", "").strip().rstrip("/")
)
cloudflare_access_audience = os.getenv("CF_ACCESS_AUDIENCE", "").strip()
if bool(cloudflare_access_team_domain) != bool(cloudflare_access_audience):
    raise RuntimeError(
        "Cloudflare Access 鉴权必须同时配置 CF_ACCESS_TEAM_DOMAIN 和 CF_ACCESS_AUDIENCE"
    )
cloudflare_access_configured = bool(
    cloudflare_access_team_domain and cloudflare_access_audience
)
browser_auth_configured = (
    bool(os.getenv("AGENT_BROWSER_PASSWORD", "")) or cloudflare_access_configured
)
if browser_auth_configured and "*" in cors_origins:
    raise RuntimeError("启用浏览器会话时 AGENT_CORS_ORIGINS 必须使用精确来源")
if (
    browser_auth_configured
    and not os.getenv("AGENT_API_KEY", "").strip()
    and bool(os.getenv("AGENT_BROWSER_PASSWORD", ""))
):
    raise RuntimeError("启用浏览器会话时必须同时配置服务端 AGENT_API_KEY")

# --- Static assets ----------------------------------------------------------

frontend_dist = (
    Path(__file__).resolve().parents[3] / "frontend" / "frontend-ui" / "dist"
)


# --- Env helpers ------------------------------------------------------------


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        return default


# --- Keys and switches ------------------------------------------------------

api_key = os.getenv("AGENT_API_KEY", "").strip()
protect_read_routes = os.getenv("AGENT_PROTECT_READS", "0").strip().lower() in {
    "1",
    "true",
    "yes",
}
local_aic = os.getenv("AGENT_LOCAL_AIC", "").strip() or None
identity_binding_enabled = os.getenv(
    "AGENT_IDENTITY_BINDING_ENABLED", ""
).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
if identity_binding_enabled and not local_aic:
    raise RuntimeError(
        "AGENT_IDENTITY_BINDING_ENABLED 已开启，但未配置 AGENT_LOCAL_AIC"
    )

# --- Timeouts and batch sizes -----------------------------------------------

battle_timeout_seconds = min(
    max(_env_int("AGENT_BATTLE_TIMEOUT_SECONDS", 300, minimum=5), 5),
    3600,
)
score_backfill_batch_size = min(
    _env_int("AGENT_SCORE_BACKFILL_BATCH_SIZE", 100, minimum=1),
    1000,
)

# --- Browser session --------------------------------------------------------

browser_password = os.getenv("AGENT_BROWSER_PASSWORD", "")
browser_session_ttl_seconds = min(
    max(_env_int("AGENT_BROWSER_SESSION_TTL_SECONDS", 28800, minimum=300), 300),
    86400,
)
browser_cookie_name = "agent_browser_session"
browser_cookie_secure = os.getenv(
    "AGENT_BROWSER_COOKIE_SECURE", "1"
).strip().lower() not in {
    "0",
    "false",
    "no",
}
browser_cookie_samesite = (
    os.getenv("AGENT_BROWSER_COOKIE_SAMESITE", "lax").strip().lower()
)
if browser_cookie_samesite not in {"lax", "strict", "none"}:
    browser_cookie_samesite = "lax"
if browser_cookie_samesite == "none" and not browser_cookie_secure:
    raise RuntimeError("SameSite=None 浏览器会话 Cookie 必须启用 Secure")

# --- Rate limits and capacity -----------------------------------------------

rate_limit_per_minute = _env_int("AGENT_RATE_LIMIT_PER_MINUTE", 60)
public_battle_limit_per_minute = _env_int("AGENT_PUBLIC_BATTLE_LIMIT_PER_MINUTE", 10)
event_data_max_bytes = _env_int("AGENT_EVENT_DATA_MAX_BYTES", 32768, minimum=1024)

# --- Data locations ---------------------------------------------------------

external_cases_database = Path(
    os.getenv("AGENT_EXTERNAL_CASE_DB", ".data/external_security_cases.sqlite3")
)
