"""WebSocket 读鉴权必须与 HTTP 读鉴权使用同一套条件。

历史缺陷：WS 路由只检查 ``protect_read_routes and api_key``，而 HTTP 读路由由
``read_auth_dependency`` 按「protect_read_routes / 浏览器密码 / Cloudflare Access」
三选一放行。只配浏览器密码时，HTTP 要登录而 WS 仍可匿名连上，能拿到实时战局
事件流。这里的用例把三条条件都钉住。
"""

from __future__ import annotations

import time
from types import SimpleNamespace

from agent_attack_lab import config, state
from agent_attack_lab.security import browser_session_digest, websocket_read_auth_allowed

ALLOWED_ORIGIN = "http://localhost:5173"


class FakeWebSocket:
    """只实现 websocket_read_auth_allowed 真正读到的属性。"""

    def __init__(self, *, headers=None, cookies=None, query=None) -> None:
        self.headers = headers or {}
        self.cookies = cookies or {}
        self.query_params = query or {}
        self.client = None
        self.url = SimpleNamespace(scheme="http")


def _clear_protection(monkeypatch) -> None:
    monkeypatch.setattr(config, "protect_read_routes", False)
    monkeypatch.setattr(config, "browser_password", "")
    monkeypatch.setattr(config, "cloudflare_access_configured", False)
    monkeypatch.setattr(config, "api_key", "")


def _active_session() -> str:
    token = "test-browser-session-token"
    with state.browser_sessions_lock:
        state.browser_sessions[browser_session_digest(token)] = time.monotonic() + 600
    return token


def test_allows_anonymous_when_no_read_protection_is_configured(monkeypatch) -> None:
    _clear_protection(monkeypatch)

    assert websocket_read_auth_allowed(FakeWebSocket()) is True


def test_rejects_anonymous_when_browser_password_is_set(monkeypatch) -> None:
    """只配浏览器密码时，WS 必须和 HTTP 读路由一样要求登录。"""
    _clear_protection(monkeypatch)
    monkeypatch.setattr(config, "browser_password", "browser-secret")

    assert websocket_read_auth_allowed(FakeWebSocket(headers={"origin": ALLOWED_ORIGIN})) is False


def test_accepts_valid_browser_session_with_allowed_origin(monkeypatch) -> None:
    _clear_protection(monkeypatch)
    monkeypatch.setattr(config, "browser_password", "browser-secret")
    token = _active_session()
    try:
        allowed = FakeWebSocket(
            headers={"origin": ALLOWED_ORIGIN},
            cookies={config.browser_cookie_name: token},
        )
        assert websocket_read_auth_allowed(allowed) is True
    finally:
        with state.browser_sessions_lock:
            state.browser_sessions.pop(browser_session_digest(token), None)


def test_rejects_session_without_origin_to_block_cross_site_hijack(monkeypatch) -> None:
    """带会话但无 Origin 的握手按跨站劫持处理。"""
    _clear_protection(monkeypatch)
    monkeypatch.setattr(config, "browser_password", "browser-secret")
    token = _active_session()
    try:
        no_origin = FakeWebSocket(cookies={config.browser_cookie_name: token})
        assert websocket_read_auth_allowed(no_origin) is False
    finally:
        with state.browser_sessions_lock:
            state.browser_sessions.pop(browser_session_digest(token), None)


def test_accepts_api_key_in_header_or_query(monkeypatch) -> None:
    _clear_protection(monkeypatch)
    monkeypatch.setattr(config, "protect_read_routes", True)
    monkeypatch.setattr(config, "api_key", "server-key")

    assert websocket_read_auth_allowed(FakeWebSocket(headers={"x-api-key": "server-key"})) is True
    assert websocket_read_auth_allowed(FakeWebSocket(query={"api_key": "server-key"})) is True
    assert websocket_read_auth_allowed(FakeWebSocket(headers={"x-api-key": "wrong"})) is False
    assert websocket_read_auth_allowed(FakeWebSocket()) is False
