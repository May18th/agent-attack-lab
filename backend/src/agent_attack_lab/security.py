"""Authentication, browser sessions and rate limiting.

Every function here reads configuration through ``config.<name>`` and mutable
state through ``state.<name>`` at call time, never through a module-level alias,
so that monkeypatching either module actually takes effect.

No route handlers live here: routers import these helpers, not the other way
around, which keeps the dependency direction one-way (routers -> security ->
config/state).
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging
import secrets
import time
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, WebSocket

from agent_attack_lab import config, state

logger = logging.getLogger("agent_attack_lab")


def check_api_key(request: Request) -> None:
    """Enable a simple deployment-time API key without affecting local development."""
    supplied = request.headers.get("x-api-key", "")
    if config.api_key and not hmac.compare_digest(
        supplied.encode("utf-8"), config.api_key.encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail="缺少或无效的 API 密钥")
    if not config.api_key and (
        config.browser_password or config.cloudflare_access_configured
    ):
        raise HTTPException(status_code=401, detail="服务端 API 密钥未配置")


def verify_cloudflare_access_jwt(token: str) -> bool:
    """Verify the Access assertion against the configured team JWKS and audience."""
    if not config.cloudflare_access_configured or not token:
        return False
    try:
        import jwt
        from jwt import PyJWKClient

        with state.cloudflare_jwk_lock:
            if state.cloudflare_jwk_client is None:
                state.cloudflare_jwk_client = PyJWKClient(
                    f"{config.cloudflare_access_team_domain}/cdn-cgi/access/certs",
                    cache_jwk_set=True,
                    lifespan=300,
                )
            jwk_client = state.cloudflare_jwk_client
        signing_key = jwk_client.get_signing_key_from_jwt(token).key
        jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=config.cloudflare_access_audience,
            issuer=config.cloudflare_access_team_domain,
            options={"require": ["exp", "iat", "iss", "aud"]},
        )
        return True
    except Exception as exc:  # noqa: BLE001 - token libraries expose heterogeneous errors.
        logger.warning("Cloudflare Access JWT rejected reason=%s", type(exc).__name__)
        return False


def browser_origin_allowed(origin: str, request: Request | None = None) -> bool:
    if origin in config.cors_origins:
        return True
    if request is None:
        return False
    try:
        parsed_origin = urlsplit(origin)
        if (
            parsed_origin.scheme.lower() not in {"http", "https"}
            or not parsed_origin.netloc
            or parsed_origin.path not in ("", "/")
        ):
            return False
        if (
            parsed_origin.query
            or parsed_origin.fragment
            or parsed_origin.username
            or parsed_origin.password
        ):
            return False
        peer_host = request.client.host if request.client else ""
        try:
            trusted_proxy = ipaddress.ip_address(peer_host).is_loopback
        except ValueError:
            trusted_proxy = False
        request_host = request.headers.get("host", "")
        request_scheme = request.url.scheme
        if trusted_proxy:
            request_host = (
                request.headers.get("x-forwarded-host", request_host)
                .split(",", 1)[0]
                .strip()
            )
            request_scheme = (
                request.headers.get("x-forwarded-proto", request_scheme)
                .split(",", 1)[0]
                .strip()
            )
        return (
            parsed_origin.scheme.lower() == request_scheme.lower()
            and parsed_origin.netloc.lower() == request_host.lower()
        )
    except ValueError:
        return False


def browser_session_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def has_browser_session(request: Request) -> bool:
    token = request.cookies.get(config.browser_cookie_name, "")
    if not token:
        return False
    digest = browser_session_digest(token)
    now = time.monotonic()
    with state.browser_sessions_lock:
        expires_at = state.browser_sessions.get(digest)
        if expires_at is None:
            return False
        if expires_at <= now:
            state.browser_sessions.pop(digest, None)
            return False
        return True


def issue_browser_session() -> str:
    token = secrets.token_urlsafe(32)
    now = time.monotonic()
    with state.browser_sessions_lock:
        expired = [
            key for key, deadline in state.browser_sessions.items() if deadline <= now
        ]
        for key in expired:
            state.browser_sessions.pop(key, None)
        if len(state.browser_sessions) >= 10000:
            raise HTTPException(status_code=503, detail="浏览器会话容量已满")
        state.browser_sessions[browser_session_digest(token)] = (
            now + config.browser_session_ttl_seconds
        )
    return token


def revoke_browser_session(request: Request) -> None:
    token = request.cookies.get(config.browser_cookie_name, "")
    if token:
        with state.browser_sessions_lock:
            state.browser_sessions.pop(browser_session_digest(token), None)


def check_browser_session_origin(request: Request) -> None:
    origin = request.headers.get("origin", "")
    if not origin and request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    if not origin or not browser_origin_allowed(origin, request):
        raise HTTPException(status_code=403, detail="浏览器来源未获允许")


def check_browser_or_api_auth(request: Request) -> None:
    supplied_api_key = request.headers.get("x-api-key", "")
    if config.api_key and hmac.compare_digest(
        supplied_api_key.encode("utf-8"), config.api_key.encode("utf-8")
    ):
        return
    access_token = request.headers.get("cf-access-jwt-assertion", "")
    if verify_cloudflare_access_jwt(access_token):
        if request.headers.get("origin"):
            check_browser_session_origin(request)
        return
    if config.browser_password and has_browser_session(request):
        check_browser_session_origin(request)
        return
    if (
        not config.api_key
        and not config.browser_password
        and not config.cloudflare_access_configured
    ):
        return
    raise HTTPException(
        status_code=401,
        detail="需要有效的 API 密钥、Cloudflare Access 身份或浏览器登录会话",
    )


def websocket_read_auth_allowed(websocket: WebSocket) -> bool:
    """WebSocket 读路由的鉴权条件，与 HTTP 的 read_auth_dependency 保持一致。

    HTTP 读路由由 read_auth_dependency 把守（protect_read_routes / 浏览器密码 /
    Cloudflare Access 三选一）。WS 路由原先只看 ``protect_read_routes and
    api_key``，于是只配浏览器密码时 HTTP 要求登录、WS 却能匿名连上，而 WS 推送的
    是实时战局事件流，比列表更细。这里补齐三条，并对浏览器会话额外校验 Origin，
    避免跨站 WebSocket 劫持。
    """
    if not (
        config.protect_read_routes
        or config.browser_password
        or config.cloudflare_access_configured
    ):
        return True
    supplied_api_key = (
        websocket.headers.get("x-api-key")
        or websocket.query_params.get("api_key")
        or ""
    )
    if config.api_key and hmac.compare_digest(
        supplied_api_key.encode("utf-8"), config.api_key.encode("utf-8")
    ):
        return True
    if verify_cloudflare_access_jwt(
        websocket.headers.get("cf-access-jwt-assertion", "")
    ):
        return True
    if config.browser_password and has_browser_session(websocket):
        origin = websocket.headers.get("origin", "")
        return bool(origin) and browser_origin_allowed(origin, websocket)
    return False


def browser_client_ip(request: Request) -> str:
    peer_host = request.client.host if request.client else "unknown"
    try:
        peer_is_loopback = ipaddress.ip_address(peer_host).is_loopback
    except ValueError:
        peer_is_loopback = False
    if peer_is_loopback:
        for header in ("cf-connecting-ip", "x-real-ip"):
            forwarded_ip = request.headers.get(header, "").strip()
            if forwarded_ip:
                try:
                    return str(ipaddress.ip_address(forwarded_ip))
                except ValueError:
                    continue
    return peer_host


def login_rate_limit(request: Request) -> None:
    client_key = browser_client_ip(request)
    now = time.monotonic()
    cutoff = now - 300
    with state.browser_login_lock:
        attempts = state.browser_login_attempts[client_key]
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()
        if len(attempts) >= 5:
            retry_after = max(1, int(300 - (now - attempts[0])))
            raise HTTPException(
                status_code=429,
                detail="登录尝试过多，请稍后重试",
                headers={"Retry-After": str(retry_after)},
            )
        attempts.append(now)


def api_key_dependency(request: Request) -> None:
    check_api_key(request)


def metrics_auth_dependency(request: Request) -> None:
    check_browser_or_api_auth(request)


def read_auth_dependency(request: Request) -> None:
    if (
        config.protect_read_routes
        or config.browser_password
        or config.cloudflare_access_configured
    ):
        check_browser_or_api_auth(request)


def public_battle_rate_limit_dependency(request: Request) -> None:
    """Limit anonymous battle creation separately from internal agent traffic."""
    if config.public_battle_limit_per_minute <= 0:
        return
    client_key = browser_client_ip(request)
    now = time.monotonic()
    cutoff = now - 60
    with state.public_battle_rate_lock:
        window = state.public_battle_rate_windows[client_key]
        while window and window[0] <= cutoff:
            window.popleft()
        if len(window) >= config.public_battle_limit_per_minute:
            retry_after = max(1, int(60 - (now - window[0])))
            raise HTTPException(
                status_code=429,
                detail="公开战局创建过于频繁，请稍后重试",
                headers={"Retry-After": str(retry_after)},
            )
        window.append(now)


def rate_limit_dependency(request: Request) -> None:
    """Apply a small in-process window limit to mutating agent endpoints."""

    if config.rate_limit_per_minute <= 0:
        return
    client_key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    cutoff = now - 60
    with state.rate_lock:
        window = state.rate_windows[client_key]
        while window and window[0] <= cutoff:
            window.popleft()
        if len(window) >= config.rate_limit_per_minute:
            state.rate_limited_count += 1
            retry_after = max(1, int(60 - (now - window[0])))
            raise HTTPException(
                status_code=429,
                detail="请求过于频繁，请稍后重试",
                headers={"Retry-After": str(retry_after)},
            )
        window.append(now)
