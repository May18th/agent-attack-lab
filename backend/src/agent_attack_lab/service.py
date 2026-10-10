from __future__ import annotations

import asyncio
import hashlib
import hmac
import inspect
import ipaddress
import json
import logging
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from collections import defaultdict, deque
from datetime import datetime, timezone
from html import escape as escape_html
from pathlib import Path
from threading import Lock
from typing import Any, Literal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from acps_sdk.aip import (
    Product,
    StructuredDataItem,
    TaskCommand,
    TaskResult,
    TaskState,
    TextDataItem,
)
from acps_sdk.aip.aip_rpc_server import (
    CommandHandlers,
    DefaultHandlers,
    TaskManager,
    handle_rpc_request,
)
from agent_attack_lab.acp_agents import (
    ACPAgentError,
    call_attacker,
    call_defender,
    is_configured as acp_agent_configured,
)
from agent_attack_lab.agent_logic import AttackRequest, DefendRequest, attack, defend, local_rule_case_count
from agent_attack_lab.owasp_rules import OWASP_LLM_CATEGORIES
from agent_attack_lab.storage import BattleStore


logger = logging.getLogger("agent_attack_lab")

app = FastAPI(
    title="智能体攻防实验室 Agent 服务",
    description="用于生成攻防测试样本并检测风险的 HTTP JSON Agent 服务。",
    version="1.0.0",
    swagger_ui_parameters={
        "docExpansion": "none",
        "defaultModelsExpandDepth": -1,
        "defaultModelExpandDepth": -1,
        "displayRequestDuration": True,
    },
)

_default_origins = {
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}
_configured_origins = {
    origin.strip()
    for origin in os.getenv("AGENT_CORS_ORIGINS", "").split(",")
    if origin.strip()
}
_cors_origins = _configured_origins or _default_origins
_cors_origin_regex = os.getenv(
    "AGENT_CORS_ORIGIN_REGEX",
    r"^https://[a-z0-9-]+\.trycloudflare\.com$",
)
_browser_auth_configured = bool(os.getenv("AGENT_BROWSER_PASSWORD", ""))
if _browser_auth_configured and "*" in _cors_origins:
    raise RuntimeError("启用浏览器会话时 AGENT_CORS_ORIGINS 必须使用精确来源")
if _browser_auth_configured and not os.getenv("AGENT_API_KEY", "").strip():
    raise RuntimeError("启用浏览器会话时必须同时配置服务端 AGENT_API_KEY")
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(_cors_origins),
    allow_origin_regex=None if _browser_auth_configured else _cors_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "X-API-Key"],
    expose_headers=["X-Total-Count"],
)

_frontend_dist = Path(__file__).resolve().parents[3] / "frontend" / "frontend-ui" / "dist"
if _frontend_dist.is_dir():
    app.mount("/ui", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend-ui")


class JsonRpcRequest(BaseModel):
    jsonrpc: Literal["2.0"]
    method: str
    params: dict[str, Any] | None = None
    id: str | int | None = None


class BattleRequest(BaseModel):
    difficulty: Literal["low", "mid", "high"] = "low"
    topic: str = Field(default="general", min_length=1, max_length=200)

    @field_validator("topic")
    @classmethod
    def validate_topic(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("topic 不能为空")
        return value


class BrowserLoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class BattleRecord(BaseModel):
    id: str
    difficulty: Literal["low", "mid", "high"]
    topic: str
    status: Literal["pending", "running", "completed", "failed"]
    createdAt: str
    attackerOut: dict[str, Any]
    defenderOut: list[dict[str, Any]]


class BattleEvent(BaseModel):
    id: str
    battleId: str
    sequence: int
    type: str
    status: str
    createdAt: str
    data: dict[str, Any] = Field(default_factory=dict)


_battle_store = BattleStore()
_started_at = time.monotonic()
_request_count = 0
_request_errors = 0
_request_total_duration_ms = 0.0
_request_max_duration_ms = 0.0
_rate_limited_count = 0
_api_key = os.getenv("AGENT_API_KEY", "").strip()
_protect_read_routes = os.getenv("AGENT_PROTECT_READS", "0").strip().lower() in {"1", "true", "yes"}
_local_aic = os.getenv("AGENT_LOCAL_AIC", "").strip() or None
_identity_binding_enabled = os.getenv(
    "AGENT_IDENTITY_BINDING_ENABLED", ""
).strip().lower() in {"1", "true", "yes", "on"}
if _identity_binding_enabled and not _local_aic:
    raise RuntimeError(
        "AGENT_IDENTITY_BINDING_ENABLED 已开启，但未配置 AGENT_LOCAL_AIC"
    )
_event_data_max_bytes = 32768
_leaderboard_cache: tuple[float, dict[str, Any]] | None = None
_recovery_tasks: set[asyncio.Task[Any]] = set()


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        return default


_browser_password = os.getenv("AGENT_BROWSER_PASSWORD", "")
_browser_session_ttl_seconds = min(
    max(_env_int("AGENT_BROWSER_SESSION_TTL_SECONDS", 28800, minimum=300), 300),
    86400,
)
_browser_cookie_name = "agent_browser_session"
_browser_cookie_secure = os.getenv("AGENT_BROWSER_COOKIE_SECURE", "1").strip().lower() not in {
    "0", "false", "no"
}
_browser_cookie_samesite = os.getenv("AGENT_BROWSER_COOKIE_SAMESITE", "lax").strip().lower()
if _browser_cookie_samesite not in {"lax", "strict", "none"}:
    _browser_cookie_samesite = "lax"
if _browser_cookie_samesite == "none" and not _browser_cookie_secure:
    raise RuntimeError("SameSite=None 浏览器会话 Cookie 必须启用 Secure")
_browser_sessions: dict[str, float] = {}
_browser_sessions_lock = Lock()
_browser_login_attempts: dict[str, deque[float]] = defaultdict(deque)
_browser_login_lock = Lock()

_rate_limit_per_minute = _env_int("AGENT_RATE_LIMIT_PER_MINUTE", 60)
_event_data_max_bytes = _env_int("AGENT_EVENT_DATA_MAX_BYTES", 32768, minimum=1024)
_rate_windows: dict[str, deque[float]] = defaultdict(deque)
_rate_lock = Lock()


def _request_id(request: Request) -> str:
    """Reuse a safe caller ID when supplied, otherwise create one locally."""
    candidate = request.headers.get("x-request-id", "").strip()
    if candidate and len(candidate) <= 128 and all(
        char.isalnum() or char in "-_.:" for char in candidate
    ):
        return candidate
    return f"req-{uuid.uuid4()}"


@app.middleware("http")
async def collect_request_metrics(request: Request, call_next: Any) -> Any:
    global _request_count, _request_errors, _request_total_duration_ms, _request_max_duration_ms
    request_id = _request_id(request)
    request.state.request_id = request_id
    started = time.perf_counter()
    _request_count += 1
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        _request_total_duration_ms += duration_ms
        _request_max_duration_ms = max(_request_max_duration_ms, duration_ms)
        _request_errors += 1
        logger.exception(
            "request_failed request_id=%s method=%s path=%s",
            request_id,
            request.method,
            request.url.path,
        )
        raise
    if response.status_code >= 400:
        _request_errors += 1
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    _request_total_duration_ms += duration_ms
    _request_max_duration_ms = max(_request_max_duration_ms, duration_ms)
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request_completed request_id=%s method=%s path=%s status=%s duration_ms=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


def _check_api_key(request: Request) -> None:
    """Enable a simple deployment-time API key without affecting local development."""
    supplied = request.headers.get("x-api-key", "")
    if _api_key and not hmac.compare_digest(supplied.encode("utf-8"), _api_key.encode("utf-8")):
        raise HTTPException(status_code=401, detail="缺少或无效的 API 密钥")
    if not _api_key and _browser_password:
        raise HTTPException(status_code=401, detail="服务端 API 密钥未配置")


def _browser_origin_allowed(origin: str) -> bool:
    return origin in _cors_origins


def _browser_session_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _has_browser_session(request: Request) -> bool:
    token = request.cookies.get(_browser_cookie_name, "")
    if not token:
        return False
    digest = _browser_session_digest(token)
    now = time.monotonic()
    with _browser_sessions_lock:
        expires_at = _browser_sessions.get(digest)
        if expires_at is None:
            return False
        if expires_at <= now:
            _browser_sessions.pop(digest, None)
            return False
        return True


def _issue_browser_session() -> str:
    token = secrets.token_urlsafe(32)
    now = time.monotonic()
    with _browser_sessions_lock:
        expired = [key for key, deadline in _browser_sessions.items() if deadline <= now]
        for key in expired:
            _browser_sessions.pop(key, None)
        if len(_browser_sessions) >= 10000:
            raise HTTPException(status_code=503, detail="浏览器会话容量已满")
        _browser_sessions[_browser_session_digest(token)] = now + _browser_session_ttl_seconds
    return token


def _revoke_browser_session(request: Request) -> None:
    token = request.cookies.get(_browser_cookie_name, "")
    if token:
        with _browser_sessions_lock:
            _browser_sessions.pop(_browser_session_digest(token), None)


def _check_browser_session_origin(request: Request) -> None:
    origin = request.headers.get("origin", "")
    if not origin or not _browser_origin_allowed(origin):
        raise HTTPException(status_code=403, detail="浏览器来源未获允许")


def _check_browser_or_api_auth(request: Request) -> None:
    supplied_api_key = request.headers.get("x-api-key", "")
    if _api_key and hmac.compare_digest(
        supplied_api_key.encode("utf-8"), _api_key.encode("utf-8")
    ):
        return
    if _browser_password and _has_browser_session(request):
        _check_browser_session_origin(request)
        return
    if not _api_key and not _browser_password:
        return
    raise HTTPException(status_code=401, detail="需要有效的 API 密钥或浏览器登录会话")


def _browser_client_ip(request: Request) -> str:
    peer_host = request.client.host if request.client else "unknown"
    try:
        peer_is_loopback = ipaddress.ip_address(peer_host).is_loopback
    except ValueError:
        peer_is_loopback = False
    forwarded_ip = request.headers.get("cf-connecting-ip", "").strip()
    if peer_is_loopback and forwarded_ip:
        try:
            return str(ipaddress.ip_address(forwarded_ip))
        except ValueError:
            pass
    return peer_host


def _browser_login_rate_limit(request: Request) -> None:
    client_key = _browser_client_ip(request)
    now = time.monotonic()
    cutoff = now - 300
    with _browser_login_lock:
        attempts = _browser_login_attempts[client_key]
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


def _api_key_dependency(request: Request) -> None:
    _check_api_key(request)


def _read_auth_dependency(request: Request) -> None:
    if _protect_read_routes or _browser_password:
        _check_browser_or_api_auth(request)


def _rate_limit_dependency(request: Request) -> None:
    """Apply a small in-process window limit to mutating agent endpoints."""
    global _rate_limited_count
    if _rate_limit_per_minute <= 0:
        return
    client_key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    cutoff = now - 60
    with _rate_lock:
        window = _rate_windows[client_key]
        while window and window[0] <= cutoff:
            window.popleft()
        if len(window) >= _rate_limit_per_minute:
            _rate_limited_count += 1
            retry_after = max(1, int(60 - (now - window[0])))
            raise HTTPException(
                status_code=429,
                detail="请求过于频繁，请稍后重试",
                headers={"Retry-After": str(retry_after)},
            )
        window.append(now)


def _invalidate_leaderboard_cache() -> None:
    global _leaderboard_cache
    _leaderboard_cache = None


def _bounded_event_data(data: dict[str, Any]) -> dict[str, Any]:
    serialized = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(serialized.encode("utf-8")) <= _event_data_max_bytes:
        return data
    compact = dict(data)
    sample = compact.get("sample")
    if isinstance(sample, dict):
        sample_copy = dict(sample)
        content = str(sample_copy.get("content", ""))
        sample_copy["content"] = content[:2048]
        sample_copy["contentTruncated"] = len(content) > 2048
        compact["sample"] = sample_copy
    compact["dataTruncated"] = True
    compact["originalBytes"] = len(serialized.encode("utf-8"))
    compact_serialized = json.dumps(compact, ensure_ascii=False, separators=(",", ":"))
    if len(compact_serialized.encode("utf-8")) <= _event_data_max_bytes:
        return compact
    return {
        "dataTruncated": True,
        "originalBytes": len(serialized.encode("utf-8")),
        "preview": serialized[: max(1, _event_data_max_bytes // 8)],
    }


def _event(battle_id: str, sequence: int, event_type: str, status: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"event-{uuid.uuid4()}",
        "battleId": battle_id,
        "sequence": sequence,
        "type": event_type,
        "status": status,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "data": _bounded_event_data(data),
    }


async def _battle_attack(payload: BattleRequest) -> tuple[dict[str, Any], str]:
    result = await call_attacker(payload.model_dump())
    source = "local-rule"
    if result is None:
        result = attack(AttackRequest.model_validate(payload.model_dump()))
        result["agentMode"] = "local-rule"
    else:
        source = result.pop("agentSource", None) or (
            "acp-llm" if result.get("agentMode") == "llm" else "acp-rule-fallback"
        )
    return {**result, "agentSource": source}, source


async def _battle_defend(sample: dict[str, Any]) -> tuple[dict[str, Any], str]:
    result = await call_defender({"sample": sample})
    source = "local-rule"
    if result is None:
        result = defend(DefendRequest(sample=sample))
        result["agentMode"] = "local-rule"
    else:
        source = result.pop("agentSource", None) or (
            "acp-llm" if result.get("agentMode") == "llm" else "acp-rule-fallback"
        )
    return {**result, "agentSource": source}, source


async def _run_battle_async(battle_id: str, payload: BattleRequest) -> None:
    """Run a battle in stages so clients can observe its event stream."""
    record = _battle_store.get(battle_id)
    if record is None:
        return
    events = _battle_store.list_events(battle_id)
    sequence = max((event["sequence"] for event in events), default=0) + 1

    def add_event(event_type: str, status: str, data: dict[str, Any]) -> None:
        nonlocal sequence
        event = _event(battle_id, sequence, event_type, status, data)
        sequence += 1
        _battle_store.save_event(event)

    try:
        record["status"] = "running"
        _battle_store.save(record)
        _invalidate_leaderboard_cache()
        add_event(
            "attack.started",
            "running",
            {
                "topic": payload.topic,
                "attackerSource": "acp-pending" if acp_agent_configured("attacker") else "local-rule",
            },
        )
        await asyncio.sleep(0.8)
        attack_result, attacker_source = await _battle_attack(payload)
        record["attackerOut"] = attack_result
        _battle_store.save(record)
        _invalidate_leaderboard_cache()
        for index, sample in enumerate(attack_result["samples"], start=1):
            add_event(
                "attack.sample.generated",
                "completed",
                {"round": index, "sample": sample, "attackerSource": attacker_source},
            )
            await asyncio.sleep(0.35)
        add_event(
            "attack.completed",
            "completed",
            {"sampleCount": len(attack_result["samples"]), "attackerSource": attacker_source},
        )

        defender_results: list[dict[str, Any]] = []
        for index, sample in enumerate(attack_result["samples"], start=1):
            add_event(
                "round.started",
                "running",
                {
                    "round": index,
                    "defenderSource": "acp-pending" if acp_agent_configured("defender") else "local-rule",
                },
            )
            await asyncio.sleep(0.8)
            defense, defender_source = await _battle_defend(sample)
            defender_results.append(defense)
            record["defenderOut"] = defender_results
            _battle_store.save(record)
            _invalidate_leaderboard_cache()
            add_event(
                "round.completed",
                "completed",
                {
                    "round": index,
                    "sample": sample,
                    "caught": defense["caught"],
                    "risks": defense["risks"],
                    "fixed": defense["fixed"],
                    "defenderSource": defender_source,
                    "analysisMode": defense.get("analysisMode"),
                    "verificationStatus": defense.get("verificationStatus"),
                    "scopeNotice": defense.get("scopeNotice"),
                },
            )
        add_event("defense.completed", "completed", {"roundCount": len(defender_results)})
        record["status"] = "completed"
        _battle_store.save(record)
        _invalidate_leaderboard_cache()
        add_event("battle.completed", "completed", {"status": record["status"]})
    except Exception as exc:
        logger.exception("Battle %s failed", battle_id)
        record["status"] = "failed"
        _battle_store.save(record)
        _invalidate_leaderboard_cache()
        message = (
            "ACP 独立 Agent 调用失败，请检查服务端日志和 URL/证书配置"
            if isinstance(exc, ACPAgentError)
            else "战局执行失败，请检查服务端日志"
        )
        add_event("battle.failed", "failed", {"error": message})


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """Resume persisted pending/running battles after a process restart."""
    recovered_ids: set[str] = set()
    for status in ("pending", "running"):
        for record in _battle_store.list(limit=200, status=status):
            if record["id"] in recovered_ids:
                continue
            recovered_ids.add(record["id"])
            payload = BattleRequest(difficulty=record["difficulty"], topic=record["topic"])
            task = asyncio.create_task(_run_battle_async(record["id"], payload))
            _recovery_tasks.add(task)
            task.add_done_callback(_recovery_tasks.discard)
    try:
        yield
    finally:
        pending = list(_recovery_tasks)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        _battle_store.close()


app.router.lifespan_context = _lifespan


@app.get("/", include_in_schema=False)
def index() -> dict[str, Any]:
    return {
        "service": "智能体攻防实验室",
        "status": "ok",
        "endpoints": [
            "/health", "/metrics", "/battles", "/battles/{id}/events",
            "/battles/{id}/report", "/leaderboard", "/agent/attack",
            "/agent/defend", "/rpc", "/docs",
        ],
        "note": "当前提供 JSON-RPC 2.0 和兼容的 HTTP JSON 接口；平台审核通过并下发证书后再启用 mTLS。",
    }


@app.get("/dashboard", response_class=HTMLResponse, include_in_schema=False)
def dashboard(
    topic: str | None = Query(default=None, max_length=200),
    difficulty: Literal["low", "mid", "high"] | None = Query(default=None),
) -> str:
    topic_value = escape_html(topic or "通用安全测试", quote=True)
    selected_difficulty = difficulty or "mid"
    return """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>智能体攻防实验室后台</title>
  <style>
    :root { color-scheme: light; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef2f5; color: #17202a; }
    header { background: #fff; border-bottom: 1px solid #d8e0e5; }
    .topbar { max-width: 1180px; margin: 0 auto; padding: 22px 24px 18px; display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
    h1 { margin: 0 0 6px; font-size: 27px; letter-spacing: .2px; }
    .sub { margin: 0; color: #65727d; font-size: 14px; }
    .status { display: flex; align-items: center; gap: 9px; color: #53616d; font-size: 13px; white-space: nowrap; padding-top: 7px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #c0392b; }
    .dot.ok { background: #1f9d55; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    .layout { display: grid; grid-template-columns: minmax(290px, .82fr) minmax(0, 1.45fr); gap: 18px; align-items: start; }
    .panel { background: #fff; border: 1px solid #d8e0e5; border-radius: 8px; padding: 20px; }
    .panel + .panel { margin-top: 18px; }
    .panel-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 16px; }
    .panel-title h2 { margin: 0; font-size: 17px; }
    .panel-title span { color: #74808a; font-size: 12px; }
    label { display: block; margin: 0 0 7px; color: #52606c; font-size: 13px; }
    input[type=text] { width: 100%; border: 1px solid #cbd5dc; border-radius: 6px; padding: 10px 11px; color: #17202a; font: inherit; outline: none; }
    input[type=text]:focus { border-color: #2878c8; box-shadow: 0 0 0 3px #2878c81c; }
    .field { margin-bottom: 18px; }
    .choices { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .choices input { position: absolute; opacity: 0; pointer-events: none; }
    .choices label { margin: 0; border: 1px solid #cbd5dc; border-radius: 6px; padding: 10px 8px; text-align: center; cursor: pointer; color: #45535f; }
    .choices input:checked + label { border-color: #2878c8; color: #125a9d; background: #edf6ff; }
    button { border: 0; border-radius: 6px; padding: 11px 16px; background: #1769aa; color: #fff; font: inherit; font-weight: 600; cursor: pointer; width: 100%; }
    button:hover { background: #12558b; }
    button:disabled { cursor: wait; opacity: .65; }
    .hint { margin: 10px 0 0; color: #77838d; font-size: 12px; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; margin-bottom: 18px; }
    .metric { border-left: 3px solid #2878c8; padding: 10px 12px; background: #f5f8fa; }
    .metric b { display: block; font-size: 22px; line-height: 1.1; }
    .metric span { display: block; margin-top: 4px; color: #687580; font-size: 12px; }
    .result { min-height: 238px; border: 1px dashed #cbd5dc; border-radius: 6px; padding: 15px; background: #fbfcfd; }
    .empty { color: #7a8790; text-align: center; padding: 78px 12px; font-size: 14px; }
    .battle-head { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid #e4eaee; }
    .battle-head strong { font-size: 15px; }
    .battle-head span { color: #667580; font-size: 12px; }
    .flow { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0 18px; }
    .flow-step { position: relative; min-height: 64px; padding: 10px 10px 8px 36px; border: 1px solid #dce5ea; border-radius: 6px; background: #f7fafb; }
    .flow-step:not(:last-child)::after { content: ""; position: absolute; top: 28px; right: -9px; width: 10px; border-top: 1px solid #a9bbc7; z-index: 1; }
    .flow-step i { position: absolute; left: 10px; top: 11px; display: grid; place-items: center; width: 19px; height: 19px; border-radius: 50%; background: #1769aa; color: #fff; font-style: normal; font-size: 11px; font-weight: 700; }
    .flow-step b { display: block; font-size: 12px; }
    .flow-step small { display: block; margin-top: 4px; color: #75818a; font-size: 11px; }
    .battle-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
    .summary-item { padding: 9px 10px; border-radius: 5px; background: #f5f8fa; text-align: center; }
    .summary-item b { display: block; font-size: 18px; }
    .summary-item span { color: #71808a; font-size: 11px; }
    .round-list { display: grid; gap: 12px; }
    .round { border: 1px solid #dce5ea; border-radius: 7px; overflow: hidden; background: #fff; }
    .round-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #f5f8fa; border-bottom: 1px solid #e4eaee; }
    .round-number { color: #1769aa; font-weight: 700; font-size: 12px; }
    .round-type { padding: 2px 6px; border-radius: 3px; background: #fff0da; color: #a46111; font-size: 11px; }
    .round-state { margin-left: auto; color: #1f8050; font-size: 11px; }
    .round-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px; }
    .round-grid h3 { margin: 0 0 7px; font-size: 12px; color: #52606c; }
    .attack-box, .defend-box { min-width: 0; padding: 10px; border-radius: 5px; font-size: 12px; line-height: 1.5; }
    .attack-box { border-left: 3px solid #e08b2c; background: #fff8ed; }
    .defend-box { border-left: 3px solid #1f9d55; background: #effaf3; }
    .round-content { margin-top: 6px; overflow-wrap: anywhere; color: #374650; }
    .result-list { margin: 5px 0 0; padding-left: 17px; color: #43535d; }
    .result-list li { margin: 2px 0; }
    .result-label { margin-top: 9px; color: #71808a; font-size: 11px; }
    .muted { color: #89959d; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #e7ecef; text-align: left; white-space: nowrap; }
    th { color: #667580; font-size: 12px; font-weight: 600; }
    td:last-child { text-align: right; }
    a { color: #1769aa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .error { color: #b42318; background: #fff1f0; border: 1px solid #f2c4bf; border-radius: 6px; padding: 10px; font-size: 13px; }
    @media (max-width: 760px) { .topbar { display: block; } .status { margin-top: 14px; } .layout { grid-template-columns: 1fr; } .round-grid { grid-template-columns: 1fr; } .flow { grid-template-columns: repeat(2, 1fr); } .flow-step:not(:last-child)::after { display: none; } .battle-summary { grid-template-columns: repeat(2, 1fr); } main { padding: 16px; } }

    /* Visual system: a focused operations console instead of a default form page. */
    :root { color-scheme: dark; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; }
    body { background: #080d18; color: #e7edf5; background-image: linear-gradient(135deg, #0d1728 0%, #080d18 48%, #111729 100%); }
    header { background: #0d1525e8; border-bottom: 1px solid #26354c; box-shadow: 0 12px 30px #02050b66; }
    .topbar { max-width: 1320px; padding: 30px 28px 26px; }
    h1 { font-size: 30px; letter-spacing: .4px; color: #f3f7fb; }
    .sub { color: #91a2b8; font-size: 13px; }
    .status { color: #a6b5c8; padding: 9px 13px; border: 1px solid #2b415b; border-radius: 999px; background: #111e31; box-shadow: inset 0 1px #ffffff08; }
    .dot { box-shadow: 0 0 0 4px #e0525220; }
    .dot.ok { box-shadow: 0 0 0 4px #32d29620; }
    main { max-width: 1320px; padding: 28px; }
    .layout { grid-template-columns: minmax(310px, .74fr) minmax(0, 1.7fr); gap: 20px; }
    .panel { background: #111a2b; border: 1px solid #26364d; border-radius: 12px; padding: 22px; box-shadow: 0 18px 45px #02050b55, inset 0 1px #ffffff08; }
    .panel + .panel { margin-top: 20px; }
    .panel-title { margin-bottom: 20px; }
    .panel-title h2 { color: #f1f5fa; font-size: 18px; }
    .panel-title span { color: #7f91a8; }
    label { color: #aebdce; }
    input[type=text] { border-color: #30445d; background: #0b1322; color: #edf4fb; border-radius: 8px; padding: 12px 13px; }
    input[type=text]:focus { border-color: #49d1b7; box-shadow: 0 0 0 3px #49d1b71f; }
    .field { margin-bottom: 21px; }
    .choices { gap: 10px; }
    .choices label { border-color: #30445d; background: #0d1727; color: #9cafc2; border-radius: 9px; padding: 12px 8px; }
    .choices input:checked + label { border-color: #49d1b7; color: #d9fff6; background: #15332f; box-shadow: inset 0 0 0 1px #49d1b733; }
    button { border-radius: 9px; background: #2f9f90; box-shadow: 0 8px 18px #02060c55; }
    button:hover { background: #45b9a7; }
    .hint { color: #74869d; }
    .metrics { gap: 10px; }
    .metric { border: 1px solid #293c55; border-left: 3px solid #49d1b7; border-radius: 9px; padding: 13px 14px; background: #0d1727; }
    .metric:nth-child(2) { border-left-color: #f5b45a; }
    .metric:nth-child(3) { border-left-color: #7aa7ff; }
    .metric b { color: #f2f7fb; font-size: 24px; }
    .metric span { color: #8395aa; }
    .result { min-height: 310px; border: 1px solid #263950; border-radius: 10px; padding: 17px; background: #0c1423; }
    .empty { color: #75869a; padding: 96px 12px; }
    .battle-head { padding-bottom: 15px; border-bottom-color: #263950; }
    .battle-head strong { color: #f5f8fb; font-size: 16px; }
    .battle-head span { color: #8da0b5; }
    .flow { gap: 10px; margin: 18px 0 20px; }
    .flow-step { min-height: 74px; padding: 12px 10px 9px 40px; border-color: #2b405a; border-radius: 9px; background: #111e31; }
    .flow-step:not(:last-child)::after { border-top-color: #3a526c; }
    .flow-step i { left: 11px; top: 13px; width: 21px; height: 21px; background: #347fc2; box-shadow: 0 0 0 4px #347fc21c; }
    .flow-step b { color: #dce8f4; }
    .flow-step small { color: #8194a9; }
    .battle-summary { gap: 10px; margin-bottom: 19px; }
    .summary-item { border: 1px solid #263950; border-radius: 9px; padding: 12px 10px; background: #111e31; }
    .summary-item b { color: #f2f7fb; font-size: 20px; }
    .summary-item span { color: #8295aa; }
    .round { border-color: #2b405a; border-radius: 10px; background: #0f192a; box-shadow: 0 12px 24px #02050b33; }
    .round-head { padding: 12px 14px; background: #142238; border-bottom-color: #293d57; }
    .round-number { color: #7fd9ff; }
    .round-type { padding: 4px 8px; border-radius: 999px; background: #3a2d1b; color: #f5c475; }
    .round-state { color: #65ddb4; }
    .round-grid { gap: 14px; padding: 14px; }
    .round-grid h3 { color: #afc0d1; }
    .attack-box, .defend-box { padding: 13px; border-radius: 8px; }
    .attack-box { border-left-color: #ed9f4d; background: #251c14; }
    .defend-box { border-left-color: #49d1b7; background: #112a2a; }
    .round-content { color: #d4dee9; }
    .result-list { color: #c4d2df; }
    .result-label { color: #8397ac; }
    .muted { color: #74869a; }
    table { color: #dbe5ef; }
    th, td { border-bottom-color: #263950; }
    th { color: #8ea1b7; }
    a { color: #72dcca; }
    .error { color: #ffb7bd; background: #311b25; border-color: #71323e; }
    .event-panel { margin-top: 16px; padding: 13px 15px; border: 1px solid #263950; border-radius: 9px; background: #0a1220; }
    .event-title { display: flex; justify-content: space-between; gap: 12px; color: #dce8f4; font-size: 12px; font-weight: 700; }
    .event-title small { color: #7f94aa; font-size: 11px; font-weight: 400; }
    .live-flow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
    .live-phase { min-width: 0; display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; gap: 3px 8px; padding: 8px 9px; border: 1px solid #263950; border-radius: 7px; background: #101a2a; color: #71869e; }
    .live-phase i { grid-row: span 2; display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid #42546a; border-radius: 50%; font: normal 10px var(--mono); }
    .live-phase b { overflow-wrap: anywhere; color: #91a2b6; font-size: 10px; }
    .live-phase small { overflow-wrap: anywhere; color: #63758b; font-size: 9px; }
    .live-phase.active { border-color: #49d1b7a6; background: #12302d; }
    .live-phase.active i { border-color: #49d1b7; color: #8cf3da; box-shadow: 0 0 0 3px #49d1b71c; animation: phase-pulse 1.4s ease-in-out infinite; }
    .live-phase.active b { color: #dcfff7; }
    .live-phase.done { border-color: #347fc277; background: #112236; }
    .live-phase.done i { border-color: #347fc2; background: #347fc2; color: #fff; }
    .live-phase.done b { color: #c3d9ee; }
    .live-phase.failed { border-color: #ef777f; background: #311b25; }
    .live-phase.failed i, .live-phase.failed b { color: #ffb7bd; border-color: #ef777f; }
    @keyframes phase-pulse { 50% { box-shadow: 0 0 0 6px #49d1b70d; } }
    .event-log { display: grid; gap: 7px; max-height: 280px; overflow: auto; margin: 10px 0 0; padding: 0; list-style: none; }
    .event-log li { display: grid; grid-template-columns: 66px minmax(0, 1fr); gap: 9px; padding: 7px 8px; border-left: 2px solid #347fc2; background: #111e31; color: #aebed0; font-size: 11px; overflow-wrap: anywhere; }
    .event-log .event-placeholder { display: block; }
    .event-log .event-enter { animation: event-enter 240ms ease-out both; }
    @keyframes event-enter { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
    .event-log time { color: #71869e; font-variant-numeric: tabular-nums; }
    .event-log .event-done { border-left-color: #49d1b7; }
    .event-log .event-failed { border-left-color: #ef777f; color: #ffb7bd; }
    .dialog-panel { margin-top: 14px; border: 1px solid #263950; border-radius: 9px; background: #0a1220; overflow: hidden; }
    .dialog-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #263950; color: #dce8f4; font-size: 12px; font-weight: 700; }
    .dialog-head small { color: #74869d; font-size: 10px; font-weight: 400; text-align: right; }
    .dialog-log { display: flex; flex-direction: column; gap: 12px; max-height: 480px; overflow: auto; margin: 0; padding: 14px; list-style: none; }
    .dialog-item { width: min(90%, 720px); min-width: 0; animation: event-enter 240ms ease-out both; }
    .dialog-item.attacker { align-self: flex-start; }
    .dialog-item.defender { align-self: flex-end; }
    .dialog-bubble { padding: 12px 14px; border: 1px solid #34485f; border-radius: 8px; background: #121f31; color: #c5d2e0; }
    .attacker .dialog-bubble { border-left: 3px solid #ed9f4d; background: #211b16; }
    .defender .dialog-bubble { border-right: 3px solid #49d1b7; background: #112321; }
    .dialog-meta { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 8px; }
    .dialog-meta b { color: #eef4fb; font-size: 12px; }
    .attacker .dialog-meta b { color: #f2c28d; }
    .defender .dialog-meta b { color: #a6efdb; }
    .dialog-meta span { color: #8194a9; font-size: 10px; text-align: right; }
    .dialog-topic { margin-bottom: 7px; color: #a9bbce; font-size: 11px; }
    .dialog-content { margin: 0; color: #f0e3d5; font: 12px/1.6 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .dialog-section { margin-top: 10px; }
    .dialog-section b { color: #9cb0c4; font-size: 10px; }
    .dialog-section ul { margin: 4px 0 0; padding-left: 17px; color: #c5d2e0; font-size: 11px; }
    .dialog-section li { margin: 2px 0; overflow-wrap: anywhere; }
    .dialog-evidence { display: inline-block; margin-top: 3px; color: #8fa4ba; line-height: 1.5; }
    .recommendation-details { margin: 7px 0 2px; border: 1px solid #31445b; border-radius: 6px; padding: 7px 9px; background: #0b1422; }
    .recommendation-details summary { color: #80d9c7; cursor: pointer; font-size: 11px; }
    .recommendation-details p { margin: 7px 0 3px; color: #bdcad8; font-size: 11px; }
    .recommendation-details ol { margin: 4px 0 7px; padding-left: 20px; color: #bdcad8; font-size: 11px; }
    .recommendation-details pre { max-height: 260px; overflow: auto; margin: 5px 0; padding: 9px; border-radius: 5px; background: #070c14; color: #b9e3dc; font: 11px/1.5 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .dialog-verification { margin: 8px 0 4px; padding: 7px 9px; border-left: 2px solid #edb45f; background: #2a2519; color: #f1d9a8; font-size: 10px; line-height: 1.5; }
    .dialog-scope { margin: 6px 0; color: #94a6b9; font-size: 10px; line-height: 1.5; }
    .dialog-pending, .dialog-empty { padding: 12px; color: #74869d; font-size: 11px; }
    .dialog-empty { text-align: center; }
    .dialog-raw { margin-top: 10px; border-top: 1px solid #34485f; padding-top: 8px; }
    .dialog-raw summary { color: #8499ae; cursor: pointer; font-size: 10px; }
    .dialog-raw pre { max-height: 180px; overflow: auto; margin: 7px 0 0; padding: 9px; border-radius: 5px; background: #080e18; color: #a9bed2; font: 10px/1.5 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .battle-visual { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(170px, .8fr) minmax(150px, 1fr); grid-template-areas: "attacker track defender" "caption caption caption"; align-items: center; gap: 10px; padding: 14px; border-top: 1px solid #263950; border-bottom: 1px solid #263950; background: #0d1726; }
    .agent-card { min-width: 0; display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 2px 10px; padding: 12px; border: 1px solid #2a3b50; border-radius: 8px; background: #111d2c; transition: border-color 180ms ease, background 180ms ease; }
    .agent-card.attacker { grid-area: attacker; }
    .agent-card.defender { grid-area: defender; }
    .agent-card .agent-mark { grid-row: span 2; display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid #56677a; border-radius: 50%; color: #b9c8d8; font: 10px var(--mono); }
    .agent-card strong { min-width: 0; color: #dce8f4; font-size: 11px; overflow-wrap: anywhere; }
    .agent-card small { min-width: 0; color: #7f94aa; font-size: 10px; overflow-wrap: anywhere; }
    .agent-card.attacker.active { border-color: #ed9f4d; background: #251d15; }
    .agent-card.attacker.active .agent-mark { border-color: #ed9f4d; color: #ffd39d; }
    .agent-card.defender.active { border-color: #49d1b7; background: #112a27; }
    .agent-card.defender.active .agent-mark { border-color: #49d1b7; color: #a6efdb; }
    .exchange-track { position: relative; grid-area: track; height: 38px; min-width: 0; }
    .exchange-track::before { position: absolute; top: 19px; left: 2%; right: 2%; height: 1px; background: #40556d; content: ""; }
    .exchange-track::after { position: absolute; top: 14px; right: 1%; width: 9px; height: 9px; border-top: 1px solid #71869e; border-right: 1px solid #71869e; transform: rotate(45deg); content: ""; }
    .exchange-packet { position: absolute; z-index: 1; top: 7px; left: 2%; max-width: 82%; padding: 4px 7px; overflow: hidden; border: 1px solid #536a82; border-radius: 5px; background: #16263a; color: #c5d5e5; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; opacity: 0; }
    .exchange-packet.outbound { animation: packet-out 650ms ease-in-out forwards; border-color: #ed9f4d; color: #ffd39d; }
    .exchange-packet.returning { animation: packet-back 650ms ease-in-out forwards; border-color: #49d1b7; color: #a6efdb; }
    @keyframes packet-out { from { left: 2%; opacity: 0; } 12% { opacity: 1; } to { left: 72%; opacity: 1; } }
    @keyframes packet-back { from { left: 72%; opacity: 0; } 12% { opacity: 1; } to { left: 2%; opacity: 1; } }
    .visual-caption { grid-area: caption; min-height: 16px; color: #8295aa; font-size: 10px; text-align: center; }
    @media (max-width: 640px) { .battle-visual { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "attacker defender" "track track" "caption caption"; } }
    .panel-title { align-items: flex-start; }
    .panel-title a { max-width: 170px; text-align: right; line-height: 1.35; }
    .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .metric { min-width: 0; overflow: hidden; }
    .metric b { overflow-wrap: anywhere; word-break: break-word; }
    .metric span { overflow-wrap: anywhere; word-break: break-word; }
    #latest { font-size: 18px; line-height: 1.25; }
    table { table-layout: fixed; }
    th, td { white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
    td:last-child { text-align: left; }
    th:nth-child(1), td:nth-child(1) { width: 24%; }
    th:nth-child(2), td:nth-child(2) { width: 12%; }
    th:nth-child(3), td:nth-child(3) { width: 15%; }
    th:nth-child(4), td:nth-child(4) { width: 25%; }
    th:nth-child(5), td:nth-child(5) { width: 24%; }
    @media (max-width: 980px) { .layout { grid-template-columns: 1fr; } .topbar { padding-left: 22px; padding-right: 22px; } main { padding: 22px; } }
    @media (max-width: 560px) { .metrics { grid-template-columns: 1fr; } .metric { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; } .metric span { margin-top: 0; text-align: right; } .flow { grid-template-columns: 1fr; } .live-flow { grid-template-columns: repeat(2, minmax(0, 1fr)); } .battle-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .panel-title { display: block; } .panel-title a { display: inline-block; margin-top: 8px; text-align: left; } }
    @media (max-width: 760px) { .topbar { padding: 24px 18px 20px; } h1 { font-size: 25px; } main { padding: 18px; } .panel { padding: 18px; } }
    .topbar { align-items: center; }
    .header-meta { display: grid; justify-items: end; gap: 8px; }
    .header-meta .status { padding: 8px 12px; }
    .status-note { color: #92a6bb; font-size: 11px; text-align: right; }
    .layout { grid-template-columns: minmax(250px, .58fr) minmax(0, 1.72fr); align-items: stretch; }
    #battle-panel { border-color: #35506b; box-shadow: 0 22px 52px #02050b77, inset 0 1px #ffffff0a; }
    #history-panel { margin-top: 20px; }
    .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .metric .metric-note { display: block; margin-top: 4px; color: #8295aa; font-size: 10px; text-align: left; }
    .dialog-log { max-height: none; padding: 12px; }
    .dialog-round { min-width: 0; overflow: hidden; border: 1px solid #2b405a; border-radius: 8px; background: #0d1726; }
    .dialog-round-head { display: flex; justify-content: space-between; gap: 10px; padding: 9px 12px; border-bottom: 1px solid #263950; color: #dce8f4; font-size: 11px; }
    .dialog-round-head small { color: #8295aa; font-size: 10px; }
    .dialog-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; padding: 10px; }
    .dialog-side { min-width: 0; padding: 10px; border-radius: 6px; background: #121f31; }
    .dialog-side.attacker { border-left: 2px solid #ed9f4d; background: #211b16; }
    .dialog-side.defender { border-left: 2px solid #49d1b7; background: #112321; }
    .dialog-side-title { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 7px; color: #e5edf6; font-size: 11px; }
    .dialog-side-title small { color: #8295aa; font-size: 9px; text-align: right; }
    .dialog-side .dialog-content { font-size: 11px; }
    .replay-controls { display: grid; grid-template-columns: repeat(4, auto) minmax(80px, 1fr) auto auto; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #263950; background: #0a1220; }
    .replay-controls[hidden] { display: none; }
    .replay-controls button { width: auto; min-height: 34px; padding: 6px 10px; border: 1px solid #344b63; background: #142238; color: #dbe8f5; font-size: 11px; }
    .replay-controls button:hover:not(:disabled) { border-color: #49d1b7; background: #18332f; }
    .replay-controls button:disabled { opacity: .45; }
    .replay-controls input { min-width: 60px; width: 100%; accent-color: #49d1b7; }
    .replay-controls select { min-height: 34px; border: 1px solid #344b63; border-radius: 5px; padding: 4px 6px; background: #101a2a; color: #dbe8f5; }
    .replay-count { color: #8ea1b7; font-size: 10px; white-space: nowrap; }
    .history-open { width: auto; padding: 6px 9px; border: 1px solid #344b63; background: #142238; font-size: 11px; }
    .round-details { margin-top: 14px; border-top: 1px solid #263950; padding-top: 10px; }
    .round-details summary { color: #a6b5c8; cursor: pointer; font-size: 11px; }
    .round-details .round-list { margin-top: 10px; }
    #result[hidden] { display: none; }
    .history-row-active { background: #15332f; }
    @media (max-width: 760px) {
      .topbar { display: flex; align-items: flex-start; gap: 12px; }
      .header-meta { justify-items: start; }
      .status-note { text-align: left; }
      .header-meta .status { max-width: 100%; white-space: normal; }
      .status-note { max-width: 100%; overflow-wrap: anywhere; }
      .layout { width: 100%; grid-template-columns: minmax(0, 1fr); }
      .layout > section, .panel { min-width: 0; }
      .dialog-pair { grid-template-columns: minmax(0, 1fr); }
      .replay-controls { grid-template-columns: repeat(4, auto) minmax(60px, 1fr); }
      .replay-controls select { grid-column: 5; }
      .replay-count { grid-column: 1 / 5; grid-row: 2; }
    }
    @media (max-width: 480px) {
      .topbar { display: block; }
      .header-meta { margin-top: 12px; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .replay-controls { grid-template-columns: repeat(4, minmax(0, auto)); }
      .replay-controls input { grid-column: 1 / 4; grid-row: 2; }
      .replay-controls select { grid-column: 4; grid-row: 2; }
      .replay-count { grid-column: 1 / -1; grid-row: 3; }
    }
    @media (max-width: 560px) { .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
  <header><div class="topbar"><div><h1>智能体攻防实验室</h1><p class="sub">攻防战局控制台</p></div><div class="header-meta"><div class="status"><span id="dot" class="dot"></span><span id="status">正在检查服务状态……</span></div><div id="agent-source-label" class="status-note">尚未选择战局 · 来源待记录</div><div id="verification-summary" class="status-note">真实目标验证：未执行</div></div></div></header>
  <main>
    <div class="layout">
      <section>
        <div class="panel">
          <div class="panel-title"><h2>开始新战局</h2><span>攻防编排</span></div>
          <form id="battle-form">
            <div class="field"><label for="topic">测试主题</label><input id="topic" name="topic" type="text" maxlength="200" value="__INITIAL_TOPIC__" required></div>
            <div class="field"><label>对抗难度</label><div class="choices"><div><input id="low" name="difficulty" value="low" type="radio" __LOW_CHECKED__><label for="low">低</label></div><div><input id="mid" name="difficulty" value="mid" type="radio" __MID_CHECKED__><label for="mid">中</label></div><div><input id="high" name="difficulty" value="high" type="radio" __HIGH_CHECKED__><label for="high">高</label></div></div></div>
            <button id="start" type="submit">开始攻防</button><p class="hint">完成后将在右侧显示攻击样本、风险依据和处置建议。演示环境使用本地模拟用例；真实 Agent 结果会标明来源。</p>
          </form>
        </div>
      </section>
      <section id="battle-panel" class="panel">
        <div class="panel-title"><h2>当前战况</h2><span id="battle-id">尚未开始</span></div>
        <div class="event-panel">
          <div class="event-title"><span>实时过程</span><small id="event-state" aria-live="polite">等待开始</small></div>
          <div id="live-flow" class="live-flow" aria-label="实时攻防阶段">
            <div class="live-phase" data-phase="create"><i>01</i><b>战局创建</b><small>等待开始</small></div>
            <div class="live-phase" data-phase="attack"><i>02</i><b>攻击生成</b><small>等待开始</small></div>
            <div class="live-phase" data-phase="defense"><i>03</i><b>防守检测</b><small>等待开始</small></div>
            <div class="live-phase" data-phase="report"><i>04</i><b>结果汇总</b><small>等待开始</small></div>
          </div>
          <ol id="event-log" class="event-log" aria-live="polite"><li class="event-placeholder">创建战局后显示攻击和防守进度</li></ol>
        </div>
        <div class="dialog-panel">
          <div class="dialog-head"><span>按回合查看攻防交互</span><small>左侧样本 · 右侧检测结果</small></div>
          <div class="battle-visual" aria-label="攻击与防守数据流">
            <div id="attacker-card" class="agent-card attacker"><span class="agent-mark">攻</span><strong>攻击智能体</strong><small id="attacker-state">待命</small></div>
            <div class="exchange-track"><span id="exchange-packet" class="exchange-packet"></span></div>
            <div id="defender-card" class="agent-card defender"><span class="agent-mark">守</span><strong>防守智能体</strong><small id="defender-state">待命</small></div>
            <div id="visual-caption" class="visual-caption">等待战局开始</div>
          </div>
          <div id="replay-controls" class="replay-controls" aria-label="战局回放控制" hidden>
            <button id="replay-start" type="button" title="回到开头">开头</button>
            <button id="replay-toggle" type="button" title="播放或暂停">播放</button>
            <button id="replay-next" type="button" title="前进一个事件">下一步</button>
            <button id="replay-prev" type="button" title="后退一个事件">上一步</button>
            <input id="replay-range" type="range" min="0" max="0" value="0" aria-label="回放进度" disabled>
            <span id="replay-count" class="replay-count">0 / 0</span>
            <select id="replay-speed" aria-label="回放速度"><option value="1500">慢速</option><option value="800" selected>正常</option><option value="350">快速</option></select>
          </div>
          <ol id="dialog-log" class="dialog-log" aria-live="polite"><li class="dialog-empty">等待攻击方提交样本</li></ol>
        </div>
        <div id="result" class="result"><div class="empty">提交主题后开始一轮攻防</div></div>
      </section>
    </div>
    <section id="history-panel" class="panel">
      <div class="panel-title"><h2>已保存战局统计</h2><a href="/docs">接口文档</a></div>
      <div class="metrics">
        <div class="metric"><b id="total">0</b><span>全部战局</span></div>
        <div class="metric"><b id="completed-count">0</b><span>已完成</span></div>
        <div class="metric"><b id="failed-count">0</b><span>失败</span></div>
        <div class="metric"><b id="sample-count">0</b><span>已保存样本</span></div>
        <div class="metric"><b id="rule-hit-count">0</b><span>规则命中</span></div>
        <div class="metric"><b id="risk-count">0</b><span>风险记录</span></div>
      </div>
      <p id="saved-data-note" class="hint">统计来自已保存战局，不含准确率推断。</p>
      <div class="table-wrap"><table><thead><tr><th>主题</th><th>难度</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody id="history"><tr><td colspan="5" class="empty">暂无历史战局</td></tr></tbody></table></div>
    </section>
  </main>
  <script>
    var $ = function (id) { return document.getElementById(id); };
    function escapeHtml(value) { return String(value).replace(/[&<>\"']/g, function (char) { return ({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#039;"})[char]; }); }
    function formatTime(value) { return value ? new Date(value).toLocaleString("zh-CN", {hour12: false}) : "--"; }
    var activeRound = null;
    function eventLabel(type) { return ({"battle.created":"战局已创建","battle.retry":"战局已重新提交","attack.started":"攻击阶段开始","attack.sample.generated":"攻击方提交样本","attack.completed":"攻击样本已生成","round.started":"开始检测本轮样本","round.completed":"本轮防守检测完成","defense.completed":"防守阶段完成","battle.completed":"战局完成","battle.failed":"战局失败"})[type] || type; }
    function updateLiveFlow(event) {
      var active = 0;
      var state = "准备阶段";
      updateBattleVisual(event);
      if (event.type === "battle.created" || event.type === "attack.started") { active = 1; state = "攻击方正在生成样本"; }
      else if (event.type === "attack.sample.generated") { active = 1; state = "攻击方已提交第 " + event.data.round + " 轮样本"; }
      else if (event.type === "attack.completed") { active = 2; state = "防守方开始逐轮检测"; }
      else if (event.type === "round.started") { active = 2; activeRound = event.data.round; state = "正在检测第 " + event.data.round + " 轮"; }
      else if (event.type === "round.completed") { active = 2; activeRound = null; state = "第 " + event.data.round + " 轮已完成，继续检测"; }
      else if (event.type === "defense.completed") { active = 3; state = "防守分析完成，正在汇总结果"; }
      else if (event.type === "battle.completed") { active = 4; state = "本场对抗已完成"; }
      else if (event.type === "battle.failed") {
        var failedPhase = document.querySelector(".live-phase.active") || document.querySelector('.live-phase[data-phase="attack"]');
        failedPhase.classList.remove("active");
        failedPhase.classList.add("failed");
        failedPhase.querySelector("small").textContent = "本场对抗失败";
        $("event-state").textContent = "本场对抗失败";
        return;
      }
      Array.prototype.forEach.call(document.querySelectorAll(".live-phase"), function (phase, index) {
        phase.classList.remove("active", "done", "failed");
        var hint = phase.querySelector("small");
        if (index < active) { phase.classList.add("done"); hint.textContent = "已完成"; }
        else if (index === active) { phase.classList.add("active"); hint.textContent = state; }
        else { hint.textContent = "等待开始"; }
      });
      $("event-state").textContent = state;
    }
    var dialogTurns = {};
    var replayEvents = [];
    var replayIndex = 0;
    var replayTimer = null;
    var liveEventReader = null;
    function animateExchange(direction, label) {
      var packet = $("exchange-packet");
      packet.className = "exchange-packet";
      packet.textContent = label;
      void packet.offsetWidth;
      packet.classList.add(direction);
    }
    function updateBattleVisual(event) {
      var attacker = $("attacker-card");
      var defender = $("defender-card");
      if (event.data.attackerSource) {
        $("attacker-state").dataset.source = agentSourceLabel(event.data.attackerSource);
      }
      if (event.data.defenderSource) {
        $("defender-state").dataset.source = agentSourceLabel(event.data.defenderSource);
      }
      var attackerLabel = $("attacker-state").dataset.source || "来源未记录";
      var defenderLabel = $("defender-state").dataset.source || "来源未记录";
      $("agent-source-label").textContent = "攻击方：" + attackerLabel + "；防守方：" + defenderLabel;
      attacker.classList.remove("active");
      defender.classList.remove("active");
      if (event.type === "battle.created" || event.type === "attack.started") {
        attacker.classList.add("active");
        $("attacker-state").textContent = attackerLabel + " · 正在生成样本";
        $("defender-state").textContent = "待命";
        $("visual-caption").textContent = "攻击智能体正在构造测试样本";
      } else if (event.type === "attack.sample.generated") {
        var sample = event.data.sample || {};
        var severity = sample.severity === "medium" ? "中" : difficulty(sample.severity);
        attacker.classList.add("active");
        $("attacker-state").textContent = "第 " + event.data.round + " 轮样本已提交";
        $("defender-state").textContent = "等待样本";
        $("visual-caption").textContent = "攻击方发送 " + sampleType(sample.type) + " · " + severity;
        animateExchange("outbound", "第 " + event.data.round + " 轮样本");
      } else if (event.type === "round.started") {
        defender.classList.add("active");
        $("attacker-state").textContent = "样本已提交";
        $("defender-state").textContent = defenderLabel + " · 正在检测第 " + event.data.round + " 轮";
        $("visual-caption").textContent = "防守智能体正在分析攻击样本";
        animateExchange("outbound", "第 " + event.data.round + " 轮送检");
      } else if (event.type === "round.completed") {
        var caught = (event.data.caught || []).length;
        var fixed = (event.data.fixed || []).length;
        $("attacker-state").textContent = "等待下一轮";
        $("defender-state").textContent = "第 " + event.data.round + " 轮已完成";
        $("visual-caption").textContent = "命中 " + caught + " 条样本规则，给出 " + fixed + " 条验证建议";
        animateExchange("returning", "检测回复 · " + caught + " 项");
      } else if (event.type === "defense.completed") {
        $("defender-state").textContent = "检测完成";
        $("visual-caption").textContent = "所有攻击样本均已完成检测";
      } else if (event.type === "battle.completed") {
        $("attacker-state").textContent = "本场完成";
        $("defender-state").textContent = "本场完成";
        $("visual-caption").textContent = "攻防流程结束，结果已汇总";
      } else if (event.type === "battle.failed") {
        $("attacker-state").textContent = "流程中断";
        $("defender-state").textContent = "流程中断";
        $("visual-caption").textContent = "本场攻防失败";
      }
    }
    function ensureRoundDialog(round) {
      if (dialogTurns[round]) return dialogTurns[round];
      var placeholder = $("dialog-log").querySelector(".dialog-empty");
      if (placeholder) placeholder.remove();
      var item = document.createElement("li");
      item.className = "dialog-round event-enter";
      item.dataset.round = round;
      var head = document.createElement("div");
      head.className = "dialog-round-head";
      var title = document.createElement("b");
      title.textContent = "第 " + round + " 轮";
      var state = document.createElement("small");
      state.textContent = "等待样本与检测结果";
      head.appendChild(title);
      head.appendChild(state);
      var pair = document.createElement("div");
      pair.className = "dialog-pair";
      var sides = {};
      ["attacker", "defender"].forEach(function (side) {
        var column = document.createElement("section");
        column.className = "dialog-side " + side;
        var meta = document.createElement("div");
        meta.className = "dialog-side-title";
        var name = document.createElement("b");
        name.textContent = side === "attacker" ? "攻击方 · 测试样本" : "防守方 · 分析结果";
        var status = document.createElement("small");
        status.textContent = side === "attacker" ? "等待提交" : "等待送检";
        meta.appendChild(name);
        meta.appendChild(status);
        var body = document.createElement("div");
        column.appendChild(meta);
        column.appendChild(body);
        pair.appendChild(column);
        sides[side] = {item: column, status: status, body: body};
      });
      item.appendChild(head);
      item.appendChild(pair);
      $("dialog-log").appendChild(item);
      var entry = {item: item, state: state, attacker: sides.attacker, defender: sides.defender};
      dialogTurns[round] = entry;
      return entry;
    }
    function createDialogMessage(side, round, statusText) {
      var group = ensureRoundDialog(round);
      var message = group[side];
      message.status.textContent = statusText;
      if (side === "attacker") group.state.textContent = "样本已提交，等待防守检测";
      return message;
    }
    function appendAttackerMessage(event) {
      var sample = event.data.sample || {};
      var round = event.data.round;
      var message = createDialogMessage("attacker", round, "第 " + round + " 轮 · #" + event.sequence + " · " + formatTime(event.createdAt));
      var tag = document.createElement("div");
      tag.className = "dialog-topic";
      var severity = sample.severity === "medium" ? "中" : difficulty(sample.severity);
      tag.textContent = (sample.simulation ? "本地模拟用例 · " : "") + (sample.testCaseId ? sample.testCaseId + " · " : "") + sampleType(sample.type) + " · " + severity + " · 主题：" + (sample.topic || "未指定");
      var content = document.createElement("p");
      content.className = "dialog-content";
      if (sample.scenario) {
        var scenario = document.createElement("div");
        scenario.className = "dialog-topic";
        scenario.textContent = "场景：" + sample.scenario + (sample.objective ? "；检查目标：" + sample.objective : "");
        message.body.appendChild(scenario);
      }
      content.textContent = sample.content || "（空样本）";
      var raw = document.createElement("details");
      raw.className = "dialog-raw";
      var summary = document.createElement("summary");
      summary.textContent = "查看原始样本 JSON";
      var pre = document.createElement("pre");
      pre.textContent = JSON.stringify(sample, null, 2);
      raw.appendChild(summary);
      raw.appendChild(pre);
      message.body.appendChild(tag);
      message.body.appendChild(content);
      message.body.appendChild(raw);
      var group = dialogTurns[round];
      group.state.textContent = "样本已提交，等待防守检测";
    }
    function appendDialogSection(parent, title, items, field, emptyText) {
      var section = document.createElement("div");
      section.className = "dialog-section";
      var heading = document.createElement("b");
      heading.textContent = title;
      var list = document.createElement("ul");
      if (!items || !items.length) {
        var empty = document.createElement("li");
        empty.textContent = emptyText;
        list.appendChild(empty);
      } else {
        items.forEach(function (entry) {
          var row = document.createElement("li");
          var value = entry[field] || entry.reason || entry.action || entry.level || "结果";
          var level = entry.level ? ({low: "低风险", medium: "中风险", high: "高风险"})[entry.level] + " · " : "";
          var status = entry.status ? " · " + statusLabel(entry.status) : "";
          row.textContent = level + (entry.owaspCategory ? entry.owaspCategory + " " + entry.owaspTitle + " · " : "") + (entry.ruleId ? entry.ruleId + " · " : "") + findingText(value) + status;
          if (entry.evidence) {
            var evidence = document.createElement("small");
            evidence.className = "dialog-evidence";
            evidence.textContent = "依据（" + (entry.sourceField || "样本") + "）：" + entry.evidence;
            row.appendChild(document.createElement("br"));
            row.appendChild(evidence);
          }
          if (Array.isArray(entry.matchedText) && entry.matchedText.length) {
            var matched = document.createElement("small");
            matched.className = "dialog-evidence";
            matched.textContent = "命中片段：" + entry.matchedText.join(" / ");
            row.appendChild(document.createElement("br"));
            row.appendChild(matched);
          }
          if (entry.example || entry.verificationSteps || entry.passCriteria || entry.failCriteria) {
            var details = document.createElement("details");
            details.className = "recommendation-details";
            var summary = document.createElement("summary");
            summary.textContent = "查看修复示例与验收标准（建议，未执行）";
            details.appendChild(summary);
            if (entry.example) {
              var exampleTitle = document.createElement("p");
              exampleTitle.textContent = entry.example.title || "修复示例";
              var code = document.createElement("pre");
              code.textContent = entry.example.code || "";
              details.appendChild(exampleTitle);
              details.appendChild(code);
            }
            if (Array.isArray(entry.verificationSteps) && entry.verificationSteps.length) {
              var stepsTitle = document.createElement("p");
              stepsTitle.textContent = "验证步骤";
              var steps = document.createElement("ol");
              entry.verificationSteps.forEach(function (step) {
                var stepItem = document.createElement("li");
                stepItem.textContent = step;
                steps.appendChild(stepItem);
              });
              details.appendChild(stepsTitle);
              details.appendChild(steps);
            }
            if (entry.passCriteria) {
              var pass = document.createElement("p");
              pass.textContent = "通过标准：" + entry.passCriteria;
              details.appendChild(pass);
            }
            if (entry.failCriteria) {
              var fail = document.createElement("p");
              fail.textContent = "失败标准：" + entry.failCriteria;
              details.appendChild(fail);
            }
            row.appendChild(details);
          }
          list.appendChild(row);
        });
      }
      section.appendChild(heading);
      section.appendChild(list);
      parent.appendChild(section);
    }
    function appendDefenderPending(event) {
      var round = event.data.round;
      if (dialogTurns[round] && dialogTurns[round].defender.status.textContent.indexOf("检测中") >= 0) return;
      var message = createDialogMessage("defender", round, "第 " + round + " 轮 · 检测中");
      var pending = document.createElement("p");
      pending.className = "dialog-pending";
      pending.textContent = "正在检查本轮提交的样本文本……";
      message.body.appendChild(pending);
      dialogTurns[round].state.textContent = "防守方正在检测";
    }
    function appendDefenderResponse(event) {
      var round = event.data.round;
      if (!dialogTurns[round]) ensureRoundDialog(round);
      if (!dialogTurns[round].defender.body.childNodes.length) appendDefenderPending({data: {round: round}});
      var message = dialogTurns[round].defender;
      message.status.textContent = "#" + event.sequence + " · " + formatTime(event.createdAt) + " · 检测完成";
      message.body.innerHTML = "";
      if (event.data.verificationStatus) {
        var verification = document.createElement("p");
        verification.className = "dialog-verification";
        verification.textContent = "验证边界：" + event.data.verificationStatus;
        message.body.appendChild(verification);
      }
      appendDialogSection(message.body, "规则命中（样本证据）", event.data.caught, "reason", "未命中当前本地规则");
      appendDialogSection(message.body, "风险评估", event.data.risks, "reason", "无额外风险");
      appendDialogSection(message.body, "修复方向与验收（建议，未执行）", event.data.fixed, "action", "暂无建议");
      if (event.data.scopeNotice || event.data.analysisMode) {
        var mode = document.createElement("p");
        mode.className = "dialog-scope";
        mode.textContent = event.data.scopeNotice || event.data.analysisMode;
        message.body.appendChild(mode);
      }
      var raw = document.createElement("details");
      raw.className = "dialog-raw";
      var summary = document.createElement("summary");
      summary.textContent = "查看原始防守响应 JSON";
      var pre = document.createElement("pre");
      pre.textContent = JSON.stringify({caught: event.data.caught || [], risks: event.data.risks || [], fixed: event.data.fixed || [], verificationStatus: event.data.verificationStatus, scopeNotice: event.data.scopeNotice, analysisMode: event.data.analysisMode}, null, 2);
      raw.appendChild(summary);
      raw.appendChild(pre);
      message.body.appendChild(raw);
      dialogTurns[round].state.textContent = "本轮检测完成 · 结果未验证真实目标";
      $("dialog-log").scrollTop = $("dialog-log").scrollHeight;
    }
    function addEvent(event) {
      var list = $("event-log");
      var placeholder = list.querySelector(".event-placeholder");
      if (placeholder) placeholder.remove();
      var item = document.createElement("li");
      item.className = (event.type === "battle.failed" ? "event-failed " : event.type === "battle.completed" ? "event-done " : "") + "event-enter";
      var time = document.createElement("time");
      time.textContent = formatTime(event.createdAt);
      var text = document.createElement("span");
      var round = event.data && event.data.round ? " · 第 " + event.data.round + " 轮（Round " + event.data.round + "）" : "";
      text.textContent = eventLabel(event.type) + round;
      item.appendChild(time);
      item.appendChild(text);
      list.appendChild(item);
      list.scrollTop = list.scrollHeight;
      updateLiveFlow(event);
      if (event.type === "attack.sample.generated") appendAttackerMessage(event);
      else if (event.type === "round.started") appendDefenderPending(event);
      else if (event.type === "round.completed") appendDefenderResponse(event);
    }
    async function followEvents(battleId) {
      if (liveEventReader) {
        try { await liveEventReader.cancel(); } catch (error) { /* The stream may already be closed. */ }
        liveEventReader = null;
      }
      $("event-log").innerHTML = "";
      $("dialog-log").innerHTML = '<li class="dialog-empty">等待攻击方提交样本（Waiting for attacker samples）</li>';
      dialogTurns = {};
      activeRound = null;
      $("attacker-card").classList.remove("active");
      $("defender-card").classList.remove("active");
      $("attacker-state").dataset.source = "";
      $("defender-state").dataset.source = "";
      $("attacker-state").textContent = "待命（Idle）";
      $("defender-state").textContent = "待命（Idle）";
      $("visual-caption").textContent = "攻防双方准备开始（Agents are ready）";
      $("event-state").textContent = "连接中（Connecting）";
      try {
        var response = await fetch("/battles/" + encodeURIComponent(battleId) + "/events/stream?follow=true");
        if (!response.ok || !response.body) throw new Error("HTTP " + response.status);
        var reader = response.body.getReader();
        liveEventReader = reader;
        var decoder = new TextDecoder();
        var buffer = "";
        var lineBreak = String.fromCharCode(10);
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, {stream: true});
          var blocks = buffer.split(lineBreak + lineBreak);
          buffer = blocks.pop() || "";
          for (var block of blocks) {
            var line = block.split(String.fromCharCode(13)).join("").split(lineBreak).find(function (entry) { return entry.indexOf("data: ") === 0; });
            if (!line) continue;
            var event = JSON.parse(line.slice(6));
            addEvent(event);
            if (["attack.completed", "round.started", "round.completed", "battle.completed"].indexOf(event.type) >= 0) await refreshBattle(battleId);
            if (event.type === "battle.completed" || event.type === "battle.failed") {
              loadDashboardSummary();
              loadHistory();
            }
          }
        }
      } catch (error) {
        $("event-state").textContent = "实时连接中断（Live connection interrupted）";
      } finally {
        if (liveEventReader && liveEventReader === reader) liveEventReader = null;
      }
    }
    function stopReplay() {
      if (replayTimer) window.clearInterval(replayTimer);
      replayTimer = null;
      $("replay-toggle").textContent = "播放";
    }
    function resetReplaySurface() {
      $("event-log").innerHTML = '<li class="event-placeholder">回放从战局创建事件开始</li>';
      $("dialog-log").innerHTML = '<li class="dialog-empty">逐步播放后显示每轮样本与分析结果</li>';
      dialogTurns = {};
      activeRound = null;
      document.querySelectorAll(".live-phase").forEach(function (phase) {
        phase.classList.remove("active", "done", "failed");
        phase.querySelector("small").textContent = "等待回放";
      });
      $("attacker-card").classList.remove("active");
      $("defender-card").classList.remove("active");
      $("attacker-state").textContent = "回放待命";
      $("defender-state").textContent = "回放待命";
      $("visual-caption").textContent = "使用回放控制逐步查看本场记录";
      $("event-state").textContent = "历史战局回放";
    }
    function renderReplayThrough(index) {
      stopReplay();
      replayIndex = Math.max(0, Math.min(index, replayEvents.length));
      resetReplaySurface();
      replayEvents.slice(0, replayIndex).forEach(addEvent);
      $("replay-range").value = replayIndex;
      $("replay-count").textContent = replayIndex + " / " + replayEvents.length + " 个事件";
      $("replay-start").disabled = replayIndex === 0;
      $("replay-prev").disabled = replayIndex === 0;
      $("replay-next").disabled = replayIndex >= replayEvents.length;
      $("replay-range").disabled = replayEvents.length === 0;
      $("result").hidden = replayIndex < replayEvents.length;
      $("event-state").textContent = replayIndex === replayEvents.length && replayIndex > 0 ? "回放结束 · 数据来自已保存事件" : "历史回放 · 已播放 " + replayIndex + " / " + replayEvents.length + " 个事件";
    }
    function openReplay(battleId) {
      stopReplay();
      if (liveEventReader) {
        liveEventReader.cancel().catch(function () {});
        liveEventReader = null;
      }
      Promise.all([
        fetch("/battles/" + encodeURIComponent(battleId)),
        fetch("/battles/" + encodeURIComponent(battleId) + "/replay")
      ]).then(function (responses) {
        if (!responses[0].ok || !responses[1].ok) throw new Error("HTTP " + (!responses[0].ok ? responses[0].status : responses[1].status));
        return Promise.all([responses[0].json(), responses[1].json()]);
      }).then(function (data) {
        var battle = data[0];
        replayEvents = data[1].events || [];
        renderBattle(battle);
        $("battle-id").textContent = battle.id;
        $("replay-controls").hidden = false;
        $("replay-range").max = replayEvents.length;
        document.querySelectorAll(".history-row-active").forEach(function (row) { row.classList.remove("history-row-active"); });
        var button = Array.from(document.querySelectorAll(".history-open")).find(function (item) { return item.dataset.battleId === battleId; });
        if (button) button.closest("tr").classList.add("history-row-active");
        renderReplayThrough(0);
        $("battle-panel").scrollIntoView({behavior: "smooth", block: "start"});
      }).catch(function () {
        $("event-state").textContent = "战局回放加载失败";
      });
    }
    function playReplay() {
      if (replayTimer) { stopReplay(); return; }
      if (!replayEvents.length) return;
      if (replayIndex >= replayEvents.length) renderReplayThrough(0);
      $("replay-toggle").textContent = "暂停";
      replayTimer = window.setInterval(function () {
        if (replayIndex >= replayEvents.length) { stopReplay(); return; }
        replayIndex += 1;
        resetReplaySurface();
        replayEvents.slice(0, replayIndex).forEach(addEvent);
        $("replay-range").value = replayIndex;
        $("replay-count").textContent = replayIndex + " / " + replayEvents.length + " 个事件";
        $("replay-start").disabled = replayIndex === 0;
        $("replay-prev").disabled = replayIndex === 0;
        $("replay-next").disabled = replayIndex >= replayEvents.length;
        $("result").hidden = replayIndex < replayEvents.length;
        if (replayIndex >= replayEvents.length) {
          stopReplay();
          $("event-state").textContent = "回放结束 · 数据来自已保存事件";
        }
      }, Number($("replay-speed").value));
    }
    function loadDashboardSummary() {
      fetch("/dashboard/summary", {cache: "no-store"}).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      }).then(renderDashboardSummary).catch(function () {
        $("saved-data-note").textContent = "已保存数据统计暂时无法加载";
      });
    }
    function difficulty(value) { return ({low: "低", mid: "中", high: "高", medium: "中"})[value] || value; }
    function agentSourceLabel(value) {
      var labels = {
        "acp-llm": "独立 ACP Agent · 大模型",
        "acp-rule-fallback": "独立 ACP Agent · 本地规则兜底",
        "acp-pending": "独立 ACP Agent · 来源待确认",
        "local-rule": "主服务 · 本地规则",
      };
      return labels[value] || (typeof value === "string" && value ? "未识别来源 · " + value : "来源未知");
    }
    function sampleType(value) { return ({defect: "缺陷", violation: "违规", vuln: "漏洞"})[value] || value; }
    function statusLabel(value) { return ({pending: "等待中", running: "进行中", completed: "已完成", failed: "失败", recommended: "建议"})[value] || value; }
    function findingText(value) { return ({"missing input validation": "缺少输入校验", "unvalidated input": "未校验输入", "add_input_validation": "增加输入校验", reject_instruction: "拒绝越权指令", use_parameterized_query: "改用参数化查询"})[value] || value; }
    function resultList(items, field, emptyText) {
      if (!items || !items.length) return '<li class="muted">' + escapeHtml(emptyText) + '</li>';
      return items.map(function (item) {
        var value = item[field] || item.reason || item.action || item.level || "结果";
        var taxonomy = item.owaspCategory ? item.owaspCategory + " " + item.owaspTitle + " · " : "";
        var rule = taxonomy + (item.ruleId ? item.ruleId + " · " : "");
        var suffix = item.status ? " · " + statusLabel(item.status) : "";
        var evidence = item.evidence ? " · 依据：" + item.evidence : "";
        var matched = Array.isArray(item.matchedText) && item.matchedText.length ? " · 命中片段：" + item.matchedText.join(" / ") : "";
        var details = "";
        if (item.example || item.verificationSteps || item.passCriteria || item.failCriteria) {
          var parts = [];
          if (item.example) parts.push("<p><b>修复示例：</b>" + escapeHtml(item.example.title || "") + "</p><pre>" + escapeHtml(item.example.code || "") + "</pre>");
          if (Array.isArray(item.verificationSteps) && item.verificationSteps.length) parts.push("<p><b>验证步骤</b></p><ol>" + item.verificationSteps.map(function (step) { return "<li>" + escapeHtml(step) + "</li>"; }).join("") + "</ol>");
          if (item.passCriteria) parts.push("<p><b>通过标准：</b>" + escapeHtml(item.passCriteria) + "</p>");
          if (item.failCriteria) parts.push("<p><b>失败标准：</b>" + escapeHtml(item.failCriteria) + "</p>");
          details = '<details class="recommendation-details"><summary>查看修复示例与验收标准（建议，未执行）</summary>' + parts.join("") + '</details>';
        }
        return '<li>' + escapeHtml(rule + findingText(value) + suffix + evidence + matched) + details + '</li>';
      }).join("");
    }
    function renderHistory(items) {
      $("history").innerHTML = items.length ? items.slice(0, 8).map(function (item) { return `<tr><td>${escapeHtml(item.topic)}</td><td>${difficulty(item.difficulty)}</td><td>${escapeHtml(statusLabel(item.status))}</td><td>${formatTime(item.createdAt)}</td><td><button type="button" class="history-open" data-battle-id="${escapeHtml(item.id)}">查看 / 回放</button></td></tr>`; }).join("") : '<tr><td colspan="5" class="empty">暂无历史战局</td></tr>';
    }
    function renderDashboardSummary(summary) {
      var targets = {totalBattles: "total", completedBattles: "completed-count", failedBattles: "failed-count", sampleCount: "sample-count", ruleHitCount: "rule-hit-count", riskCount: "risk-count"};
      Object.keys(targets).forEach(function (key) { $(targets[key]).textContent = Number(summary[key] || 0).toLocaleString("zh-CN"); });
      $("saved-data-note").textContent = "统计来自全部已保存战局 · 本地模拟样本 " + Number(summary.simulationSampleCount || 0).toLocaleString("zh-CN") + " 条 · 至少发生一次 ACP 调用 " + Number(summary.acpCallBattles || 0).toLocaleString("zh-CN") + " 场。ACP 是通信协议，不代表真实目标已验证。";
    }
    function renderBattle(battle) {
      var samples = battle.attackerOut.samples || [];
      var defenses = battle.defenderOut || [];
      var caughtCount = defenses.reduce(function (sum, item) { return sum + (item.caught || []).length; }, 0);
      var riskCount = defenses.reduce(function (sum, item) { return sum + (item.risks || []).length; }, 0);
      var fixedCount = defenses.reduce(function (sum, item) { return sum + (item.fixed || []).length; }, 0);
      var attackerSource = agentSourceLabel(battle.attackerOut.agentSource);
      var defenderSources = Array.from(new Set(defenses.map(function (item) { return agentSourceLabel(item.agentSource); })));
      var isSimulation = samples.some(function (sample) { return sample.simulation === true; });
      $("agent-source-label").textContent = "本场来源：攻击 " + attackerSource + " · 防守 " + (defenderSources.join(" / ") || "等待记录");
      $("verification-summary").textContent = isSimulation ? "本地模拟用例 · 真实目标验证：未执行" : "真实目标验证：未执行";
      $("result").hidden = false;
      var rounds = samples.map(function (sample, index) {
        var defense = defenses[index] || {};
        var state = defense.verificationStatus ? "检测完成 · 目标未验证" : battle.status === "failed" ? "战局失败" : "等待检测";
        return `<article class="round"><div class="round-head"><span class="round-number">第 ${index + 1} 轮</span><span class="round-type">${escapeHtml(sampleType(sample.type))} · ${escapeHtml(difficulty(sample.severity))}</span><span class="round-state">${state}</span></div><div class="round-grid"><div class="attack-box"><h3>攻击方 · 样本生成</h3><div><b>场景：</b>${escapeHtml(sample.scenario || "未提供")}</div><div><b>检查目标：</b>${escapeHtml(sample.objective || "未提供")}</div><div><b>主题：</b>${escapeHtml(sample.topic)}</div><div><b>测试输入：</b></div><div class="round-content">${escapeHtml(sample.content)}</div></div><div class="defend-box"><h3>防守方 · 检测与处置</h3><div class="result-label">规则命中（样本证据）</div><ul class="result-list">${resultList(defense.caught, "reason", "未命中当前规则")}</ul><div class="result-label">条件性风险</div><ul class="result-list">${resultList(defense.risks, "reason", "无额外风险记录")}</ul><div class="result-label">修复方向与验收（建议，未执行）</div><ul class="result-list">${resultList(defense.fixed, "action", "暂无建议")}</ul></div></div></article>`;
      }).join("") || '<div class="empty">本轮没有生成样本（No samples generated）</div>';
      var sourceLabel = escapeHtml(isSimulation ? "本地模拟" : attackerSource);
      $("result").innerHTML = `<div class="battle-head"><strong>${escapeHtml(battle.topic)} · ${difficulty(battle.difficulty)}难度</strong><span>${sourceLabel} · ${escapeHtml(statusLabel(battle.status))} · ${formatTime(battle.createdAt)}</span></div><div class="flow"><div class="flow-step"><i>1</i><b>战局创建</b><small>接收主题与难度</small></div><div class="flow-step"><i>2</i><b>攻击生成</b><small>输出 ${samples.length} 个样本</small></div><div class="flow-step"><i>3</i><b>规则分析</b><small>检查提交样本文本</small></div><div class="flow-step"><i>4</i><b>结果汇总</b><small>提出 ${fixedCount} 项验证建议</small></div></div><div class="battle-summary"><div class="summary-item"><b>${samples.length}</b><span>样本数</span></div><div class="summary-item"><b>${caughtCount}</b><span>规则命中</span></div><div class="summary-item"><b>${riskCount}</b><span>条件性风险</span></div><div class="summary-item"><b>${fixedCount}</b><span>验证建议</span></div></div><details class="round-details"><summary>查看逐轮证据详情（${samples.length} 轮）</summary><div class="round-list">${rounds}</div></details>`;
      applyEvidenceLabels(battle);
    }
    function applyEvidenceLabels(battle) {
      var flow = $("result").querySelectorAll(".flow-step");
      if (flow[2]) {
        flow[2].querySelector("b").textContent = "规则分析";
        flow[2].querySelector("small").textContent = "只检查提交样本";
      }
      if (flow[3]) flow[3].querySelector("small").textContent = "给出建议，不代表已修复";
      var summary = $("result").querySelectorAll(".summary-item span");
      ["样本数", "规则命中", "条件性风险", "验证建议"].forEach(function (label, index) {
        if (summary[index]) summary[index].textContent = label;
      });
      $("result").querySelectorAll(".round").forEach(function (card, index) {
        var sample = (battle.attackerOut.samples || [])[index] || {};
        var defense = (battle.defenderOut || [])[index] || {};
        var attackBox = card.querySelector(".attack-box");
        var defenseBox = card.querySelector(".defend-box");
        var attackTitle = attackBox && attackBox.querySelector("h3");
        var defenseTitle = defenseBox && defenseBox.querySelector("h3");
        var labels = card.querySelectorAll(".result-label");
        if (attackTitle) attackTitle.textContent = sample.simulation ? "攻击方 · 本地模拟用例" : "攻击方 · 提交样本";
        if (defenseTitle) defenseTitle.textContent = "防守方 · 样本规则分析";
        if (labels[0]) labels[0].textContent = "规则命中（样本证据）";
        if (labels[1]) labels[1].textContent = "条件性风险";
        if (labels[2]) labels[2].textContent = "修复方向与验收（建议，未执行）";
        if (sample.testCaseId && attackBox && attackTitle) {
          var caseId = document.createElement("div");
          caseId.textContent = "用例编号：" + sample.testCaseId;
          attackBox.insertBefore(caseId, attackTitle.nextSibling);
        }
        if (defenseBox && (defense.verificationStatus || defense.scopeNotice)) {
          var scope = document.createElement("p");
          scope.className = "dialog-scope";
          scope.textContent = (defense.verificationStatus || "目标验证状态未知") + (defense.scopeNotice ? "；" + defense.scopeNotice : "");
          defenseBox.appendChild(scope);
        }
      });
    }
    async function refreshBattle(battleId) {
      try {
        var response = await fetch("/battles/" + encodeURIComponent(battleId));
        if (!response.ok) return;
        var battle = await response.json();
        var defenses = battle.defenderOut || [];
        renderBattle(battle);
        document.querySelectorAll(".round-state").forEach(function (state, index) {
          state.textContent = defenses[index] ? "已完成" : activeRound === index + 1 ? "检测中" : "等待检测";
        });
      } catch (error) {
        return;
      }
    }
    function loadHistory() { fetch("/battles?limit=50").then(function (response) { if (!response.ok) throw new Error("HTTP " + response.status); return response.json(); }).then(renderHistory).catch(function () { $("history").innerHTML = '<tr><td colspan="5" class="error">历史战局暂时无法加载</td></tr>'; }); }
    function checkHealth() {
      var controller = new AbortController();
      var timeout = window.setTimeout(function () { controller.abort(); }, 5000);
      $("status").textContent = "正在检查服务状态……";
      fetch("/health", {cache: "no-store", signal: controller.signal}).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      }).then(function (data) {
        $("dot").className = "dot ok";
        $("status").textContent = "服务运行正常";
      }).catch(function (error) {
        $("dot").className = "dot";
        $("status").textContent = error.name === "AbortError" ? "服务检查超时" : "服务检查失败";
      }).finally(function () { window.clearTimeout(timeout); });
    }
    var launchParams = new URLSearchParams(window.location.search);
    var launchTopic = launchParams.get("topic");
    if (launchTopic && launchTopic.trim()) $("topic").value = launchTopic.trim().slice(0, 200);
    var launchDifficulty = launchParams.get("difficulty");
    if (["low", "mid", "high"].indexOf(launchDifficulty) !== -1) {
      var launchRadio = document.querySelector('input[name="difficulty"][value="' + launchDifficulty + '"]');
      if (launchRadio) launchRadio.checked = true;
    }
    checkHealth();
    window.setInterval(checkHealth, 30000);
    $("history").addEventListener("click", function (event) {
      var button = event.target.closest(".history-open");
      if (button) openReplay(button.dataset.battleId);
    });
    $("replay-start").addEventListener("click", function () { renderReplayThrough(0); });
    $("replay-prev").addEventListener("click", function () { renderReplayThrough(replayIndex - 1); });
    $("replay-next").addEventListener("click", function () { renderReplayThrough(replayIndex + 1); });
    $("replay-toggle").addEventListener("click", playReplay);
    $("replay-range").addEventListener("input", function () { renderReplayThrough(Number(this.value)); });
    $("replay-speed").addEventListener("change", function () {
      var wasPlaying = Boolean(replayTimer);
      if (wasPlaying) { stopReplay(); playReplay(); }
    });
    $("battle-form").addEventListener("submit", function (event) { event.preventDefault(); var button = $("start"); var topic = $("topic").value.trim(); var difficultyValue = document.querySelector("input[name=difficulty]:checked").value; if (!topic) return; stopReplay(); $("replay-controls").hidden = true; button.disabled = true; button.textContent = "攻防进行中……"; $("event-log").innerHTML = ""; $("result").hidden = false; $("result").innerHTML = '<div class="empty">正在准备攻防战局</div>'; fetch("/battles?background=true", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({topic: topic, difficulty: difficultyValue})}).then(function (response) { if (!response.ok) throw new Error("HTTP " + response.status); return response.json(); }).then(function (battle) { renderBattle(battle); $("battle-id").textContent = battle.id; loadHistory(); loadDashboardSummary(); void followEvents(battle.id); }).catch(function (error) { $("result").innerHTML = '<div class="error">战局创建失败：' + escapeHtml(error.message) + '</div>'; $("event-state").textContent = "创建失败"; }).finally(function () { button.disabled = false; button.textContent = "开始攻防"; }); });
    loadHistory();
    loadDashboardSummary();
  </script>
</body>
</html>""".replace('$("result").innerHTML = "', '$("result").innerHTML = \'').replace('</div>";\n', '</div>\';\n').replace('class="battle-head"', 'class=\\"battle-head\\"').replace('class="flow"', 'class=\\"flow\\"').replace('class="flow-step"', 'class=\\"flow-step\\"').replace('class="battle-summary"', 'class=\\"battle-summary\\"').replace('class="summary-item"', 'class=\\"summary-item\\"').replace('class="round-list"', 'class=\\"round-list\\"').replace(',""":"&quot;",', ',\\"":"&quot;",').replace("__INITIAL_TOPIC__", topic_value).replace("__LOW_CHECKED__", "checked" if selected_difficulty == "low" else "").replace("__MID_CHECKED__", "checked" if selected_difficulty == "mid" else "").replace("__HIGH_CHECKED__", "checked" if selected_difficulty == "high" else "")


@app.get("/health", summary="服务健康检查", tags=["核心接口"])
def health(request: Request) -> dict[str, Any]:
    storage_status = "ok"
    try:
        _battle_store.count()
    except Exception:
        storage_status = "error"
    return {
        "status": "ok" if storage_status == "ok" else "degraded",
        "service": "智能体攻防实验室",
        "version": app.version,
        "uptimeSeconds": round(time.monotonic() - _started_at, 2),
        "storage": storage_status,
        "requestId": request.state.request_id,
    }


@app.get("/auth/session", summary="查询浏览器登录状态", tags=["浏览器鉴权"])
def browser_session_status(request: Request, response: Response) -> dict[str, bool]:
    response.headers["Cache-Control"] = "no-store"
    return {
        "enabled": bool(_browser_password),
        "authenticated": bool(_browser_password) and _has_browser_session(request),
    }


@app.post(
    "/auth/session",
    dependencies=[Depends(_browser_login_rate_limit)],
    summary="创建浏览器登录会话",
    tags=["浏览器鉴权"],
)
def create_browser_session(
    payload: BrowserLoginRequest,
    request: Request,
    response: Response,
) -> dict[str, Any]:
    if not _browser_password:
        raise HTTPException(status_code=503, detail="浏览器登录尚未启用")
    origin = request.headers.get("origin", "")
    if origin and not _browser_origin_allowed(origin):
        raise HTTPException(status_code=403, detail="浏览器来源未获允许")
    if not hmac.compare_digest(
        payload.password.encode("utf-8"), _browser_password.encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail="登录密码错误")
    token = _issue_browser_session()
    response.set_cookie(
        key=_browser_cookie_name,
        value=token,
        max_age=_browser_session_ttl_seconds,
        httponly=True,
        secure=_browser_cookie_secure,
        samesite=_browser_cookie_samesite,
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": True, "expiresInSeconds": _browser_session_ttl_seconds}


@app.delete("/auth/session", summary="退出浏览器登录", tags=["浏览器鉴权"])
def delete_browser_session(request: Request, response: Response) -> dict[str, bool]:
    origin = request.headers.get("origin", "")
    if origin and not _browser_origin_allowed(origin):
        raise HTTPException(status_code=403, detail="浏览器来源未获允许")
    _revoke_browser_session(request)
    response.delete_cookie(
        key=_browser_cookie_name,
        httponly=True,
        secure=_browser_cookie_secure,
        samesite=_browser_cookie_samesite,
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": False}


@app.get("/metrics", include_in_schema=False, dependencies=[Depends(_api_key_dependency)])
def metrics() -> dict[str, Any]:
    average_latency = _request_total_duration_ms / _request_count if _request_count else 0
    return {
        "service": "智能体攻防实验室",
        "uptimeSeconds": round(time.monotonic() - _started_at, 2),
        "requests": _request_count,
        "errors": _request_errors,
        "averageLatencyMs": round(average_latency, 2),
        "maxLatencyMs": round(_request_max_duration_ms, 2),
        "rateLimited": _rate_limited_count,
        "rateLimitPerMinute": _rate_limit_per_minute,
        "protectReadRoutes": _protect_read_routes,
        "eventDataMaxBytes": _event_data_max_bytes,
        "recoveryTasks": len(_recovery_tasks),
        "battles": _battle_store.count(),
        "events": _battle_store.count_events(),
    }


@app.get(
    "/dashboard/summary",
    summary="查询后台统计摘要",
    description="规则命中、风险记录和已保存样本分别从全部已保存战局聚合；本地模拟用例数按规则库中的唯一用例编号统计。",
    tags=["统计接口"],
    dependencies=[Depends(_read_auth_dependency)],
)
def dashboard_summary() -> dict[str, int]:
    return {
        **_battle_store.dashboard_summary(),
        "ruleLibraryCaseCount": local_rule_case_count(),
        "owaspLlmRuleCount": len(OWASP_LLM_CATEGORIES),
    }


@app.post(
    "/battles",
    dependencies=[Depends(_rate_limit_dependency)],
    status_code=201,
    summary="创建一场攻防战局",
    description="输入测试主题和难度，返回完整的攻击样本与防守结果。添加 background=true 可启用分阶段实时执行。",
    tags=["战局接口"],
)
async def create_battle(
    payload: BattleRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    background: bool = Query(default=False, description="是否后台异步执行"),
) -> BattleRecord:
    _check_browser_or_api_auth(request)
    battle_id = f"battle-{uuid.uuid4()}"
    created_at = datetime.now(timezone.utc).isoformat()
    if background:
        record = BattleRecord(
            id=battle_id,
            difficulty=payload.difficulty,
            topic=payload.topic,
            status="pending",
            createdAt=created_at,
            attackerOut={"samples": []},
            defenderOut=[],
        )
        _battle_store.save(record.model_dump())
        _invalidate_leaderboard_cache()
        _battle_store.save_event(
            _event(
                battle_id,
                1,
                "battle.created",
                "pending",
                {
                    "topic": payload.topic,
                    "difficulty": payload.difficulty,
                    "attackerSource": "acp-pending" if acp_agent_configured("attacker") else "local-rule",
                    "defenderSource": "acp-pending" if acp_agent_configured("defender") else "local-rule",
                },
            )
        )
        background_tasks.add_task(_run_battle_async, battle_id, payload)
        return record

    events: list[dict[str, Any]] = []
    sequence = 1

    def add_event(event_type: str, status: str, data: dict[str, Any]) -> None:
        nonlocal sequence
        events.append(_event(battle_id, sequence, event_type, status, data))
        sequence += 1

    add_event(
        "battle.created",
        "completed",
        {
            "topic": payload.topic,
            "difficulty": payload.difficulty,
            "attackerSource": "acp-pending" if acp_agent_configured("attacker") else "local-rule",
            "defenderSource": "acp-pending" if acp_agent_configured("defender") else "local-rule",
        },
    )
    add_event(
        "attack.started",
        "completed",
        {
            "topic": payload.topic,
            "attackerSource": "acp-pending" if acp_agent_configured("attacker") else "local-rule",
        },
    )
    try:
        attack_result, attacker_source = await _battle_attack(payload)
        add_event(
            "attack.completed",
            "completed",
            {"sampleCount": len(attack_result["samples"]), "attackerSource": attacker_source},
        )
        defense_results: list[dict[str, Any]] = []
        for sample in attack_result["samples"]:
            defense, _ = await _battle_defend(sample)
            defense_results.append(defense)
    except ACPAgentError as exc:
        logger.warning("Synchronous battle failed (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail="独立 ACP Agent 调用失败，请检查服务端配置和日志",
        ) from None
    for index, (sample, defense) in enumerate(zip(attack_result["samples"], defense_results), start=1):
        add_event(
            "round.completed",
            "completed",
            {
                "round": index,
                "sample": sample,
                "caught": defense["caught"],
                "risks": defense["risks"],
                "fixed": defense["fixed"],
                "defenderSource": defense["agentSource"],
                "analysisMode": defense.get("analysisMode"),
                "verificationStatus": defense.get("verificationStatus"),
                "scopeNotice": defense.get("scopeNotice"),
            },
        )
    add_event("defense.completed", "completed", {"roundCount": len(defense_results)})
    record = BattleRecord(
        id=battle_id,
        difficulty=payload.difficulty,
        topic=payload.topic,
        status="completed",
        createdAt=created_at,
        attackerOut=attack_result,
        defenderOut=defense_results,
    )
    _battle_store.save(record.model_dump())
    _invalidate_leaderboard_cache()
    add_event("battle.completed", "completed", {"status": record.status})
    for event in events:
        _battle_store.save_event(event)
    return record


@app.post(
    "/battles/{battle_id}/retry",
    dependencies=[Depends(_rate_limit_dependency)],
    status_code=202,
    summary="重试失败战局",
    description="将失败战局重置为等待中并重新执行；需要配置 API Key 时沿用创建战局的密钥。",
    tags=["战局接口"],
)
def retry_battle(
    battle_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
) -> BattleRecord:
    _check_browser_or_api_auth(request)
    record = _battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    if record["status"] != "failed":
        raise HTTPException(status_code=409, detail="只有失败战局可以重试")
    record["status"] = "pending"
    record["attackerOut"] = {"samples": []}
    record["defenderOut"] = []
    _battle_store.save(record)
    _invalidate_leaderboard_cache()
    events = _battle_store.list_events(battle_id)
    _battle_store.save_event(
        _event(
            battle_id,
            max((item["sequence"] for item in events), default=0) + 1,
            "battle.retry",
            "pending",
            {"topic": record["topic"], "difficulty": record["difficulty"]},
        )
    )
    payload = BattleRequest(difficulty=record["difficulty"], topic=record["topic"])
    background_tasks.add_task(_run_battle_async, battle_id, payload)
    return BattleRecord.model_validate(record)


@app.delete(
    "/battles/{battle_id}",
    dependencies=[Depends(_rate_limit_dependency)],
    status_code=204,
    summary="删除已结束的战局",
    description="删除 completed 或 failed 战局及其事件；pending/running 战局必须先结束。",
    tags=["战局接口"],
)
def delete_battle(battle_id: str, request: Request) -> Response:
    _check_browser_or_api_auth(request)
    record = _battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    if record["status"] in {"pending", "running"}:
        raise HTTPException(status_code=409, detail="运行中的战局不能删除")
    _battle_store.delete(battle_id)
    _invalidate_leaderboard_cache()
    return Response(status_code=204)


@app.get(
    "/battles",
    summary="查询历史战局",
    description="支持分页、难度和关键词筛选。",
    tags=["战局接口"],
    dependencies=[Depends(_read_auth_dependency)],
)
def list_battles(
    response: Response,
    limit: int = Query(default=50, ge=1, le=200, description="返回的最大战局数量"),
    offset: int = Query(default=0, ge=0, le=100000, description="跳过的战局数量"),
    difficulty: Literal["low", "mid", "high"] | None = Query(default=None),
    status: str | None = Query(default=None, max_length=30),
    q: str | None = Query(default=None, max_length=200, description="按主题或编号搜索"),
) -> list[BattleRecord]:
    response.headers["X-Total-Count"] = str(
        _battle_store.count(difficulty=difficulty, status=status, query=q)
    )
    return [
        BattleRecord.model_validate(item)
        for item in _battle_store.list(
            limit=limit, offset=offset, difficulty=difficulty, status=status, query=q
        )
    ]


@app.get("/battles/{battle_id}/events", include_in_schema=False, dependencies=[Depends(_read_auth_dependency)])
def get_battle_events(battle_id: str) -> list[BattleEvent]:
    if _battle_store.get(battle_id) is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    return [BattleEvent.model_validate(item) for item in _battle_store.list_events(battle_id)]


@app.get("/battles/{battle_id}/replay", include_in_schema=False, dependencies=[Depends(_read_auth_dependency)])
def replay_battle(battle_id: str) -> dict[str, Any]:
    if _battle_store.get(battle_id) is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    return {"battleId": battle_id, "events": _battle_store.list_events(battle_id), "mode": "replay"}


@app.get(
    "/battles/{battle_id}",
    summary="查询战局详情",
    description="按战局编号恢复攻击、防守和修复结果。",
    tags=["战局接口"],
    dependencies=[Depends(_read_auth_dependency)],
)
def get_battle(battle_id: str) -> BattleRecord:
    record = _battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    return BattleRecord.model_validate(record)


def _scores(record: dict[str, Any]) -> tuple[int, int]:
    samples = record["attackerOut"].get("samples", [])
    defenses = record.get("defenderOut", [])
    severity_points = {"low": 10, "medium": 20, "high": 30}
    attacker_score = sum(severity_points.get(sample.get("severity", "low"), 10) for sample in samples)
    defender_score = sum(
        len(item.get("caught", [])) * 10 + len(item.get("fixed", [])) * 5
        for item in defenses
    )
    return attacker_score, defender_score


def _markdown_report(record: dict[str, Any], events: list[dict[str, Any]]) -> str:
    attacker_score, defender_score = _scores(record)
    lines = [
        f"# 智能体攻防战报：{record['topic']}",
        "",
        f"- 战局编号：`{record['id']}`",
        f"- 难度：{record['difficulty']}",
        f"- 状态：{record['status']}",
        f"- 创建时间：{record['createdAt']}",
        f"- 攻击方得分：{attacker_score}",
        f"- 防守方得分：{defender_score}",
        "",
        "## 对抗过程",
        "",
    ]
    samples = record["attackerOut"].get("samples", [])
    defenses = record.get("defenderOut", [])
    for index, sample in enumerate(samples, start=1):
        defense = defenses[index - 1] if index - 1 < len(defenses) else {}
        lines.extend(
            [
                f"### 第 {index} 轮：{sample.get('type', 'unknown')} / {sample.get('severity', 'unknown')}",
                f"- 主题：{sample.get('topic', record['topic'])}",
                f"- 攻击内容：{sample.get('content', '')}",
                f"- 发现问题：{', '.join(item.get('reason', '') for item in defense.get('caught', [])) or '无'}",
                f"- 风险：{', '.join(item.get('reason', '') for item in defense.get('risks', [])) or '无'}",
                f"- 修复动作：{', '.join(item.get('action', '') for item in defense.get('fixed', [])) or '无'}",
                "",
            ]
        )
    lines.extend(["## 事件记录", ""])
    for event in events:
        lines.append(f"- `{event['sequence']}` {event['type']}：{event['createdAt']}")
    return "\n".join(lines) + "\n"


@app.get("/battles/{battle_id}/report", include_in_schema=False, dependencies=[Depends(_read_auth_dependency)])
@app.get(
    "/reports/{battle_id}",
    summary="查看或下载战报",
    description="默认返回 JSON；将 format 设置为 markdown 可下载 Markdown 战报。",
    tags=["战报接口"],
    dependencies=[Depends(_read_auth_dependency)],
)
def battle_report(
    battle_id: str,
    format: Literal["json", "markdown"] = Query(default="json"),
) -> Any:
    record = _battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    events = _battle_store.list_events(battle_id)
    if format == "markdown":
        return PlainTextResponse(
            _markdown_report(record, events),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{battle_id}.md"'},
        )
    attacker_score, defender_score = _scores(record)
    return {
        "battle": record,
        "events": events,
        "scores": {"attacker": attacker_score, "defender": defender_score},
    }


@app.get(
    "/leaderboard",
    summary="查看攻防排行榜",
    description="返回攻击方和防守方的累计得分与对抗轮次。",
    tags=["统计接口"],
    dependencies=[Depends(_read_auth_dependency)],
)
def leaderboard() -> dict[str, Any]:
    global _leaderboard_cache
    now = time.monotonic()
    if _leaderboard_cache and now - _leaderboard_cache[0] < 2:
        return _leaderboard_cache[1]
    attacker_score = defender_score = 0
    rounds = 0
    for record in _battle_store.list(limit=100000):
        attack_points, defend_points = _scores(record)
        attacker_score += attack_points
        defender_score += defend_points
        rounds += len(record["attackerOut"].get("samples", []))
    result = {
        "items": [
            {"agent": "attacker", "score": attacker_score, "rounds": rounds},
            {"agent": "defender", "score": defender_score, "rounds": rounds},
        ],
    }
    _leaderboard_cache = (now, result)
    return result


@app.get("/battles/{battle_id}/events/stream", include_in_schema=False, dependencies=[Depends(_read_auth_dependency)])
async def event_stream(battle_id: str, follow: bool = Query(default=False)) -> StreamingResponse:
    if _battle_store.get(battle_id) is None:
        raise HTTPException(status_code=404, detail="战局不存在")

    async def generate() -> Any:
        sent = 0
        attempts = 0
        while attempts < (60 if follow else 1):
            events = _battle_store.list_events(battle_id)
            for event in events[sent:]:
                yield f"id: {event['id']}\nevent: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                sent += 1
            terminal = bool(events and events[-1]["type"] in {"battle.completed", "battle.failed"})
            if not follow or terminal and sent >= len(events):
                break
            attempts += 1
            await asyncio.sleep(0.2)

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.websocket("/ws/battles/{battle_id}")
async def battle_websocket(websocket: WebSocket, battle_id: str) -> None:
    if _protect_read_routes and _api_key:
        supplied_key = websocket.headers.get("x-api-key") or websocket.query_params.get("api_key")
        if supplied_key != _api_key:
            await websocket.close(code=4401, reason="缺少或无效的 API 密钥")
            return
    if _battle_store.get(battle_id) is None:
        await websocket.close(code=4404, reason="战局不存在")
        return
    await websocket.accept()
    sent = 0
    try:
        for _ in range(60):
            events = _battle_store.list_events(battle_id)
            for event in events[sent:]:
                await websocket.send_json(event)
                sent += 1
            if events and events[-1]["type"] in {"battle.completed", "battle.failed"} and sent >= len(events):
                await websocket.send_json({"type": "stream.completed", "battleId": battle_id})
                break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        return
    finally:
        if websocket.client_state.name == "CONNECTED":
            await websocket.close()


@app.post(
    "/agent/attack",
    dependencies=[Depends(_api_key_dependency), Depends(_rate_limit_dependency)],
    include_in_schema=False,
)
def agent_attack(payload: AttackRequest) -> dict[str, Any]:
    return attack(payload)


@app.post(
    "/agent/defend",
    dependencies=[Depends(_api_key_dependency), Depends(_rate_limit_dependency)],
    include_in_schema=False,
)
def agent_defend(payload: DefendRequest) -> dict[str, Any]:
    result = defend(payload)
    return {key: result[key] for key in ("caught", "risks", "fixed")}


def _command_text(command: TaskCommand) -> str:
    for item in command.dataItems or []:
        if isinstance(item, TextDataItem):
            return item.text
    return ""


async def _aip_start(command: TaskCommand, task: TaskResult | None) -> TaskResult:
    result = await DefaultHandlers.start(command, task)
    command_params = command.commandParams or {}
    payload: dict[str, Any] = command_params.get("payload", {})
    if not payload:
        try:
            parsed = json.loads(_command_text(command))
            if isinstance(parsed, dict):
                payload = parsed
        except (TypeError, ValueError):
            payload = {"topic": _command_text(command)}

    action = command_params.get("action")
    if action is None:
        action = "defend" if "sample" in payload else "attack"
    output = (
        defend(DefendRequest.model_validate(payload))
        if action == "defend"
        else attack(AttackRequest.model_validate(payload))
    )
    data_item = StructuredDataItem(data=output)
    TaskManager.set_products(
        command.taskId,
        [
            Product(
                id=f"product-{uuid.uuid4()}",
                name=f"{action}-result",
                dataItems=[data_item],
            )
        ],
    )
    return TaskManager.update_task_status(
        command.taskId, TaskState.AwaitingCompletion, data_items=[data_item]
    )


_aip_handlers = CommandHandlers(on_start=_aip_start)


@app.post(
    "/rpc",
    dependencies=[Depends(_api_key_dependency), Depends(_rate_limit_dependency)],
    include_in_schema=False,
)
async def rpc(request: Request) -> dict[str, Any]:
    """JSON-RPC endpoint supporting both AIP ``rpc`` and simple agent methods."""
    body = await request.json()
    if body.get("method") == "rpc":
        options = {
            "local_aic": _local_aic,
            "identity_binding_enabled": _identity_binding_enabled,
        }
        parameters = inspect.signature(handle_rpc_request).parameters
        if not any(
            parameter.kind is inspect.Parameter.VAR_KEYWORD
            for parameter in parameters.values()
        ):
            options = {key: value for key, value in options.items() if key in parameters}
        response = await handle_rpc_request(request, _aip_handlers, **options)
        return response.model_dump(by_alias=True, exclude_none=True)

    parsed_request = JsonRpcRequest.model_validate(body)
    params = parsed_request.params or {}
    try:
        if parsed_request.method == "attack":
            result = attack(AttackRequest.model_validate(params))
        elif parsed_request.method == "defend":
            result = defend(DefendRequest.model_validate(params))
        else:
            return {
                "jsonrpc": "2.0",
                "id": parsed_request.id,
                "error": {"code": -32601, "message": "Method not found"},
            }
    except Exception as exc:
        return {
            "jsonrpc": "2.0",
            "id": parsed_request.id,
            "error": {"code": -32602, "message": "Invalid params", "data": str(exc)},
        }
    return {"jsonrpc": "2.0", "id": parsed_request.id, "result": result}

