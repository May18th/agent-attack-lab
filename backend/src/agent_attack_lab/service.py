from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from html import escape as escape_html
from typing import Any, Literal

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
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    HTMLResponse,
    PlainTextResponse,
    RedirectResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles

from agent_attack_lab import (
    battle_runner,
    config,
    routers,
    scoring_glue,
    security,
    state,
)
from agent_attack_lab import events as events_api
from agent_attack_lab.acp_agents import (
    ACPAgentError,
)
from agent_attack_lab.acp_agents import (
    is_configured as acp_agent_configured,
)
from agent_attack_lab.agent_logic import (
    AttackRequest,
    DefendRequest,
    attack,
    defend,
)
from agent_attack_lab.agents.arbiter import review_round
from agent_attack_lab.agents.reporter import summarize as summarize_report
from agent_attack_lab.agents.rule_discovery import (
    suggest_rule_candidate,
)
from agent_attack_lab.aip_compat import server_identity_options
from agent_attack_lab.battle_audit import audit_battle
from agent_attack_lab.layer_interceptions import derive_layer_interceptions
from agent_attack_lab.models import (
    AdminRuleRequest,
    AdminSampleRequest,
    BattleEvent,
    BattleRecord,
    BattleRequest,
    BrowserLoginRequest,
    JsonRpcRequest,
    RuleCandidateRequest,
)
from agent_attack_lab.reports import build_markdown_report
from agent_attack_lab.scoring import SCORING_VERSION, score_battle_rounds
from agent_attack_lab.target_verify import (
    aggregate_verdict,
    configured_verify_mode,
    verify_round,
)

logger = logging.getLogger("agent_attack_lab")

app = FastAPI(
    title="智能体攻防实验室 Agent 服务",
    description="用于生成攻防测试样本并检测风险的 HTTP JSON Agent 服务。",
    version=config.service_version,
    swagger_ui_parameters={
        "docExpansion": "none",
        "defaultModelsExpandDepth": -1,
        "defaultModelExpandDepth": -1,
        "displayRequestDuration": True,
    },
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(config.cors_origins),
    allow_origin_regex=None
    if config.browser_auth_configured
    else config.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "X-API-Key"],
    expose_headers=[
        "X-Total-Count",
        "X-Request-ID",
        "X-Battle-ID",
        "X-Has-More",
        "X-Next-Sequence",
    ],
)

if config.frontend_dist.is_dir():
    app.mount(
        "/ui",
        StaticFiles(directory=str(config.frontend_dist), html=True),
        name="frontend-ui",
    )


_aip_server_options = server_identity_options(
    handle_rpc_request,
    local_aic=config.local_aic,
    enabled=config.identity_binding_enabled,
    setting_name="AGENT_IDENTITY_BINDING_ENABLED",
)


def _request_id(request: Request) -> str:
    """Reuse a safe caller ID when supplied, otherwise create one locally."""
    candidate = request.headers.get("x-request-id", "").strip()
    if (
        candidate
        and len(candidate) <= 128
        and all(char.isalnum() or char in "-_.:" for char in candidate)
    ):
        return candidate
    return f"req-{uuid.uuid4()}"


def _idempotency_key(request: Request) -> str | None:
    value = request.headers.get("idempotency-key", "").strip()
    if not value:
        return None
    if len(value) > 128 or any(char.isspace() for char in value):
        raise HTTPException(status_code=400, detail="Idempotency-Key 格式无效")
    return value


def _battle_fingerprint(payload: BattleRequest) -> str:
    serialized = json.dumps(
        payload.model_dump(), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


@app.middleware("http")
async def collect_request_metrics(request: Request, call_next: Any) -> Any:
    request_id = _request_id(request)
    request.state.request_id = request_id
    started = time.perf_counter()
    state.request_count += 1
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        state.request_total_duration_ms += duration_ms
        state.request_max_duration_ms = max(state.request_max_duration_ms, duration_ms)
        state.request_errors += 1
        logger.exception(
            "request_failed request_id=%s method=%s path=%s",
            request_id,
            request.method,
            request.url.path,
        )
        raise
    if response.status_code >= 400:
        state.request_errors += 1
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    state.request_total_duration_ms += duration_ms
    state.request_max_duration_ms = max(state.request_max_duration_ms, duration_ms)
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request_completed request_id=%s method=%s path=%s status=%s duration_ms=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    events_api.record_audit_event(
        "http.request",
        status="completed" if response.status_code < 400 else "failed",
        request_id=request_id,
        actor_role="http",
        data={
            "method": request.method,
            "path": request.url.path,
            "statusCode": response.status_code,
            "durationMs": duration_ms,
        },
    )
    return response


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """Resume persisted pending/running battles after a process restart."""
    recovered_ids: set[str] = set()
    recovered_records: list[dict[str, Any]] = []
    page_size = 200
    for status in ("pending", "running"):
        offset = 0
        while True:
            records = state.battle_store.list(
                limit=page_size, offset=offset, status=status
            )
            recovered_records.extend(records)
            offset += len(records)
            if len(records) < page_size:
                break
    for record in recovered_records:
        if record["id"] in recovered_ids:
            continue
        recovered_ids.add(record["id"])
        payload = BattleRequest(
            difficulty=record["difficulty"],
            topic=record["topic"],
            rounds=record.get("rounds", 3),
        )
        task = asyncio.create_task(
            battle_runner.run_battle_with_tracking(record["id"], payload)
        )
        state.recovery_tasks.add(task)
        task.add_done_callback(state.recovery_tasks.discard)
    score_backfill = asyncio.create_task(scoring_glue.run_score_backfill())
    state.recovery_tasks.add(score_backfill)
    score_backfill.add_done_callback(state.recovery_tasks.discard)
    try:
        yield
    finally:
        pending = list(state.recovery_tasks)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        state.battle_store.close()
        state.redis_cache.close()


app.router.lifespan_context = _lifespan


@app.get("/login", response_class=HTMLResponse, include_in_schema=False)
def browser_login_page(
    request: Request,
    next: str = Query(default="/dashboard", max_length=2048),
) -> Response:
    destination = next or "/dashboard"
    if (
        not destination.startswith("/")
        or destination.startswith(("//", "/login"))
        or "\\" in destination
        or any(ord(char) < 32 for char in destination)
    ):
        destination = "/dashboard"
    if config.browser_password and security.has_browser_session(request):
        return RedirectResponse(
            destination, status_code=303, headers={"Cache-Control": "no-store"}
        )
    login_enabled = bool(config.browser_password)
    disabled_message = (
        "浏览器密码登录尚未启用，请联系服务管理员配置。"
        if not login_enabled
        else "使用后台管理密码建立安全浏览器会话。"
    )
    page = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>后台登录 · 智能体攻防实验室</title>
  <style>
    :root { color-scheme: light; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; color: #17202a; background: #f2f5f7; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: linear-gradient(135deg, #eaf3fb, #f7f8f8 55%, #e8f4ee); }
    main { width: min(100%, 420px); }
    .brand { margin: 0 0 20px; color: #52616d; font-size: 13px; letter-spacing: .08em; }
    .brand strong { display: block; margin-top: 7px; color: #17202a; font-size: 25px; letter-spacing: 0; }
    form { padding: 28px; border: 1px solid #d6e0e5; border-radius: 8px; background: #fff; box-shadow: 0 16px 40px #1e354510; }
    h1 { margin: 0 0 7px; font-size: 21px; }
    .hint { margin: 0 0 23px; color: #667580; font-size: 13px; line-height: 1.6; }
    label { display: block; margin-bottom: 8px; color: #35434e; font-size: 13px; font-weight: 600; }
    input { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #bfcbd2; border-radius: 5px; font: inherit; }
    input:focus { border-color: #1673b8; outline: 3px solid #1673b822; }
    button { width: 100%; min-height: 44px; margin-top: 18px; border: 0; border-radius: 5px; background: #176fae; color: white; font: inherit; font-weight: 600; cursor: pointer; }
    button:hover { background: #105e96; }
    button:disabled { cursor: wait; opacity: .65; }
    [role=alert] { min-height: 20px; margin-top: 12px; color: #b42318; font-size: 13px; }
    .disabled { padding: 12px; border: 1px solid #e5c981; border-radius: 5px; background: #fff9e8; color: #705314; font-size: 13px; line-height: 1.6; }
    @media (max-width: 480px) { body { padding: 18px; } form { padding: 23px 19px; } }
  </style>
</head>
<body>
  <main>
    <p class="brand">AGENT ATTACK LAB<strong>后台管理登录</strong></p>
    <form id="login-form" data-next="__NEXT__" autocomplete="on">
      <h1>登录管理后台</h1>
      <p class="hint">__MESSAGE__</p>
      __FORM_CONTENT__
      <div id="error" role="alert" aria-live="polite"></div>
    </form>
  </main>
  <script>
    const form = document.getElementById("login-form");
    const passwordInput = document.getElementById("password");
    if (form && passwordInput) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button");
        const error = document.getElementById("error");
        button.disabled = true;
        error.textContent = "";
        try {
          const response = await fetch("/auth/session", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: passwordInput.value }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.detail || "登录失败，请重试");
          window.location.replace(form.dataset.next || "/dashboard");
        } catch (failure) {
          error.textContent = failure instanceof Error ? failure.message : "登录失败，请重试";
          button.disabled = false;
          passwordInput.focus();
        }
      });
    }
  </script>
</body>
</html>"""
    form_content = (
        '<label for="password">后台管理密码</label><input id="password" name="password" type="password" '
        'autocomplete="current-password" required maxlength="256" autofocus><button type="submit">登录</button>'
        if login_enabled
        else f'<div class="disabled">{escape_html(disabled_message)}</div>'
    )
    page = page.replace("__NEXT__", escape_html(destination, quote=True))
    page = page.replace("__MESSAGE__", escape_html(disabled_message))
    page = page.replace("__FORM_CONTENT__", form_content)
    return HTMLResponse(
        page, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    )


@app.get("/auth/session", summary="查询浏览器登录状态", tags=["浏览器鉴权"])
def browser_session_status(request: Request, response: Response) -> dict[str, bool]:
    response.headers["Cache-Control"] = "no-store"
    authenticated = bool(config.browser_password) and security.has_browser_session(
        request
    )
    if security.verify_cloudflare_access_jwt(
        request.headers.get("cf-access-jwt-assertion", "")
    ):
        authenticated = True
    return {
        "enabled": bool(config.browser_password) or config.cloudflare_access_configured,
        "authenticated": authenticated,
    }


@app.post(
    "/auth/session",
    dependencies=[Depends(security.login_rate_limit)],
    summary="创建浏览器登录会话",
    tags=["浏览器鉴权"],
)
def create_browser_session(
    payload: BrowserLoginRequest,
    request: Request,
    response: Response,
) -> dict[str, Any]:
    if not config.browser_password:
        raise HTTPException(status_code=503, detail="浏览器登录尚未启用")
    origin = request.headers.get("origin", "")
    if origin and not security.browser_origin_allowed(origin, request):
        raise HTTPException(status_code=403, detail="浏览器来源未获允许")
    if not hmac.compare_digest(
        payload.password.encode("utf-8"), config.browser_password.encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail="登录密码错误")
    token = security.issue_browser_session()
    response.set_cookie(
        key=config.browser_cookie_name,
        value=token,
        max_age=config.browser_session_ttl_seconds,
        httponly=True,
        secure=config.browser_cookie_secure,
        samesite=config.browser_cookie_samesite,
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {
        "authenticated": True,
        "expiresInSeconds": config.browser_session_ttl_seconds,
    }


@app.delete("/auth/session", summary="退出浏览器登录", tags=["浏览器鉴权"])
def delete_browser_session(request: Request, response: Response) -> dict[str, bool]:
    origin = request.headers.get("origin", "")
    if origin and not security.browser_origin_allowed(origin, request):
        raise HTTPException(status_code=403, detail="浏览器来源未获允许")
    security.revoke_browser_session(request)
    response.delete_cookie(
        key=config.browser_cookie_name,
        httponly=True,
        secure=config.browser_cookie_secure,
        samesite=config.browser_cookie_samesite,
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": False}


def _admin_write_audit(request: Request, event_type: str, data: dict[str, Any]) -> None:
    events_api.record_audit_event(
        event_type,
        status="accepted",
        request_id=request.state.request_id,
        actor_role="admin",
        data=data,
    )


@app.get("/admin/samples", summary="查询管理员攻击样本库", tags=["管理员资源"])
def list_admin_samples(
    request: Request,
    response: Response,
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    security.check_browser_or_api_auth(request)
    items = state.battle_store.list_admin_samples(
        query=q.strip() if q else None, limit=limit, offset=offset
    )
    response.headers["X-Total-Count"] = str(len(items))
    return items


@app.post(
    "/admin/samples", status_code=201, summary="新增管理员攻击样本", tags=["管理员资源"]
)
def create_admin_sample(
    payload: AdminSampleRequest, request: Request
) -> dict[str, Any]:
    security.check_browser_or_api_auth(request)
    item = state.battle_store.save_admin_sample(payload.model_dump())
    _admin_write_audit(
        request,
        "admin.sample.created",
        {"sampleId": item["id"], "topic": item["topic"]},
    )
    return item


@app.patch(
    "/admin/samples/{sample_id}", summary="编辑管理员攻击样本", tags=["管理员资源"]
)
def update_admin_sample(
    sample_id: str, payload: AdminSampleRequest, request: Request
) -> dict[str, Any]:
    security.check_browser_or_api_auth(request)
    item = state.battle_store.update_admin_sample(sample_id, payload.model_dump())
    if item is None:
        raise HTTPException(status_code=404, detail="攻击样本不存在")
    _admin_write_audit(request, "admin.sample.updated", {"sampleId": sample_id})
    return item


@app.delete(
    "/admin/samples/{sample_id}",
    status_code=204,
    summary="删除管理员攻击样本",
    tags=["管理员资源"],
)
def delete_admin_sample(sample_id: str, request: Request) -> Response:
    security.check_browser_or_api_auth(request)
    if not state.battle_store.delete_admin_sample(sample_id):
        raise HTTPException(status_code=404, detail="攻击样本不存在")
    _admin_write_audit(request, "admin.sample.deleted", {"sampleId": sample_id})
    return Response(status_code=204)


@app.get("/admin/rules", summary="查询管理员防守规则库", tags=["管理员资源"])
def list_admin_rules(
    request: Request,
    response: Response,
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    security.check_browser_or_api_auth(request)
    items = state.battle_store.list_admin_rules(
        query=q.strip() if q else None, limit=limit, offset=offset
    )
    response.headers["X-Total-Count"] = str(len(items))
    return items


@app.post(
    "/admin/rules", status_code=201, summary="新增管理员防守规则", tags=["管理员资源"]
)
def create_admin_rule(payload: AdminRuleRequest, request: Request) -> dict[str, Any]:
    security.check_browser_or_api_auth(request)
    item = state.battle_store.save_admin_rule(payload.model_dump())
    _admin_write_audit(
        request, "admin.rule.created", {"ruleId": item["id"], "name": item["name"]}
    )
    return item


@app.post(
    "/admin/rule-candidates/propose",
    summary="根据人工复核结果生成规则候选",
    description="仅返回 pending_human_approval 候选，不写入正式规则库；审核通过后由管理员通过 /admin/rules 单独录入。",
    tags=["管理员资源"],
)
async def propose_admin_rule_candidate(
    payload: RuleCandidateRequest,
    request: Request,
) -> dict[str, Any]:
    security.check_browser_or_api_auth(request)
    result = await suggest_rule_candidate(payload.model_dump())
    _admin_write_audit(
        request,
        "admin.rule.candidate.proposed",
        {
            "topic": payload.topic,
            "agentSource": result.get("agentSource"),
            "requiresHumanApproval": True,
        },
    )
    return result


@app.patch("/admin/rules/{rule_id}", summary="编辑管理员防守规则", tags=["管理员资源"])
def update_admin_rule(
    rule_id: str, payload: AdminRuleRequest, request: Request
) -> dict[str, Any]:
    security.check_browser_or_api_auth(request)
    item = state.battle_store.update_admin_rule(rule_id, payload.model_dump())
    if item is None:
        raise HTTPException(status_code=404, detail="防守规则不存在")
    _admin_write_audit(request, "admin.rule.updated", {"ruleId": rule_id})
    return item


@app.delete(
    "/admin/rules/{rule_id}",
    status_code=204,
    summary="删除管理员防守规则",
    tags=["管理员资源"],
)
def delete_admin_rule(rule_id: str, request: Request) -> Response:
    security.check_browser_or_api_auth(request)
    if not state.battle_store.delete_admin_rule(rule_id):
        raise HTTPException(status_code=404, detail="防守规则不存在")
    _admin_write_audit(request, "admin.rule.deleted", {"ruleId": rule_id})
    return Response(status_code=204)


@app.get("/admin/audit-logs", summary="查询管理员审计日志", tags=["管理员资源"])
def list_admin_audit_logs(
    request: Request,
    from_time: str | None = Query(default=None, max_length=40),
    to_time: str | None = Query(default=None, max_length=40),
    user: str | None = Query(default=None, max_length=64),
    operation: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[dict[str, Any]]:
    security.check_browser_or_api_auth(request)
    return state.battle_store.list_audit_events_filtered(
        from_time=from_time,
        to_time=to_time,
        actor_role=user,
        event_type=operation,
        limit=limit,
    )


@app.get(
    "/battles/{battle_id}/audit",
    summary="审计战局事件完整性",
    description="只读检查事件序列、战局归属、状态和 Agent 来源是否一致，不修改战局数据。",
    tags=["战局接口"],
    dependencies=[Depends(security.read_auth_dependency)],
)
def battle_audit(battle_id: str) -> dict[str, Any]:
    record = state.battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    result = audit_battle(record, state.battle_store.list_events(battle_id))
    result["auditEvents"] = state.battle_store.list_audit_events(battle_id=battle_id)
    return result


@app.post(
    "/battles",
    dependencies=[Depends(security.public_battle_rate_limit_dependency)],
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
    idempotency_key = _idempotency_key(request) if background else None
    fingerprint = _battle_fingerprint(payload) if idempotency_key else None
    if idempotency_key and fingerprint:
        with state.idempotency_lock:
            existing = state.battle_store.get_idempotency(idempotency_key)
            if existing is not None:
                if existing["fingerprint"] != fingerprint:
                    raise HTTPException(
                        status_code=409, detail="Idempotency-Key 已用于不同请求"
                    )
                existing_record = state.battle_store.get(existing["battleId"])
                if existing_record is None:
                    raise HTTPException(
                        status_code=409, detail="幂等记录对应的战局已不存在"
                    )
                events_api.record_audit_event(
                    "battle.idempotency.reused",
                    status="reused",
                    request_id=request.state.request_id,
                    battle_id=existing["battleId"],
                    actor_role="public",
                    data={"idempotencyKeyPresent": True},
                )
                return BattleRecord.model_validate(existing_record)
    battle_id = f"battle-{uuid.uuid4()}"
    battle_code = state.battle_store.next_battle_code()
    created_at = datetime.now(UTC).isoformat()
    if background:
        record = BattleRecord(
            id=battle_id,
            code=battle_code,
            difficulty=payload.difficulty,
            topic=payload.topic,
            status="pending",
            rounds=payload.rounds,
            createdAt=created_at,
            attackerOut={"samples": []},
            defenderOut=[],
        )
        state.battle_store.save(record.model_dump())
        if idempotency_key and fingerprint:
            state.battle_store.save_idempotency(idempotency_key, fingerprint, battle_id)
        events_api.record_audit_event(
            "battle.created",
            status="accepted",
            request_id=request.state.request_id,
            battle_id=battle_id,
            actor_role="public",
            data={
                "difficulty": payload.difficulty,
                "idempotencyKeyPresent": bool(idempotency_key),
            },
        )
        state.battle_store.save_event(
            events_api.build_event(
                battle_id,
                1,
                "battle.created",
                "pending",
                {
                    "topic": payload.topic,
                    "difficulty": payload.difficulty,
                    "rounds": payload.rounds,
                    "attackerSource": "acp-pending"
                    if acp_agent_configured("attacker")
                    else "local-rule",
                    "defenderSource": "acp-pending"
                    if acp_agent_configured("defender")
                    else "local-rule",
                },
            )
        )
        battle_runner.schedule_battle_task(background_tasks, battle_id, payload)
        return record

    events: list[dict[str, Any]] = []
    sequence = 1

    def add_event(event_type: str, status: str, data: dict[str, Any]) -> None:
        nonlocal sequence
        events.append(
            events_api.build_event(battle_id, sequence, event_type, status, data)
        )
        sequence += 1

    add_event(
        "battle.created",
        "completed",
        {
            "topic": payload.topic,
            "difficulty": payload.difficulty,
            "rounds": payload.rounds,
            "attackerSource": "acp-pending"
            if acp_agent_configured("attacker")
            else "local-rule",
            "defenderSource": "acp-pending"
            if acp_agent_configured("defender")
            else "local-rule",
        },
    )
    add_event(
        "attack.started",
        "completed",
        {
            "topic": payload.topic,
            "attackerSource": "acp-pending"
            if acp_agent_configured("attacker")
            else "local-rule",
        },
    )
    attack_result: dict[str, Any] = {"samples": []}
    defense_results: list[dict[str, Any]] = []
    defense_call_ids: list[str] = []
    verification_mode = configured_verify_mode()
    verifications: list[dict[str, Any]] = []
    try:
        (
            attack_result,
            attacker_source,
            attack_call_id,
        ) = await battle_runner.tracked_agent_call(
            battle_id=battle_id,
            role="attacker",
            invoke=lambda correlation_id: battle_runner.battle_attack(
                payload, correlation_id=correlation_id
            ),
            add_event=add_event,
        )
        add_event(
            "attack.completed",
            "completed",
            {
                "sampleCount": len(attack_result["samples"]),
                "rounds": payload.rounds,
                "attackerSource": attacker_source,
                "correlationId": attack_call_id,
            },
        )
        for sample in attack_result["samples"]:
            defense, _, defense_call_id = await battle_runner.tracked_agent_call(
                battle_id=battle_id,
                role="defender",
                invoke=lambda correlation_id, current_sample=sample: (
                    battle_runner.battle_defend(
                        current_sample, correlation_id=correlation_id
                    )
                ),
                add_event=add_event,
            )
            defense_results.append(defense)
            defense_call_ids.append(defense_call_id)
    except Exception as exc:
        message = (
            "独立 ACP Agent 调用失败，请检查服务端配置和日志"
            if isinstance(exc, ACPAgentError)
            else "战局执行失败，请检查服务端日志"
        )
        add_event("battle.failed", "failed", {"error": message})
        failed_record = BattleRecord(
            id=battle_id,
            code=battle_code,
            difficulty=payload.difficulty,
            topic=payload.topic,
            status="failed",
            rounds=payload.rounds,
            createdAt=created_at,
            attackerOut=attack_result,
            defenderOut=defense_results,
        )
        state.battle_store.save(failed_record.model_dump())
        for event in events:
            state.battle_store.save_event(event)
        scoring_glue.persist_internal_score(failed_record.model_dump())
        await asyncio.to_thread(scoring_glue.invalidate_leaderboard_cache)
        if isinstance(exc, ACPAgentError):
            raise HTTPException(
                status_code=502,
                detail=message,
                headers={"X-Battle-ID": battle_id},
            ) from None
        raise
    for index, (sample, defense, correlation_id) in enumerate(
        zip(attack_result["samples"], defense_results, defense_call_ids), start=1
    ):
        verification = verify_round(sample, defense, mode=verification_mode)
        verifications.append(verification)
        arbiter_review = await review_round(sample, defense, verification)
        defense["arbiterReview"] = arbiter_review
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
                "arbiterReview": arbiter_review,
                "correlationId": correlation_id,
            },
        )
        if verification["verified"]:
            add_event(
                "attack.compromised",
                "completed",
                {
                    "round": index,
                    "targetAssetId": verification.get("targetAssetId"),
                    "targetVerified": True,
                    "verificationMode": verification["mode"],
                    "simulated": verification["simulated"],
                    "evidence": verification["evidence"],
                    "correlationId": correlation_id,
                },
            )
    add_event(
        "defense.completed",
        "completed",
        {
            "roundCount": len(defense_results),
            "rounds": payload.rounds,
            "verificationMode": verification_mode,
            "layerInterceptions": derive_layer_interceptions(
                payload.topic, defense_results
            ),
        },
    )
    record = BattleRecord(
        id=battle_id,
        code=battle_code,
        difficulty=payload.difficulty,
        topic=payload.topic,
        status="completed",
        rounds=payload.rounds,
        verdict=aggregate_verdict(verification_mode, verifications, defense_results),
        createdAt=created_at,
        attackerOut=attack_result,
        defenderOut=defense_results,
    )
    state.battle_store.save(record.model_dump())
    await asyncio.to_thread(scoring_glue.invalidate_leaderboard_cache)
    add_event(
        "battle.completed",
        "completed",
        {
            "status": record.status,
            "verdict": record.verdict,
            "compromisedRounds": sum(1 for item in verifications if item["verified"]),
            "interceptedRounds": sum(
                1 for item in defense_results if item.get("caught")
            ),
            "verificationMode": verification_mode,
        },
    )
    for event in events:
        state.battle_store.save_event(event)
    scoring_glue.persist_internal_score(record.model_dump())
    return record


@app.post(
    "/battles/{battle_id}/retry",
    dependencies=[Depends(security.rate_limit_dependency)],
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
    security.check_browser_or_api_auth(request)
    record = state.battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    if record["status"] != "failed":
        raise HTTPException(status_code=409, detail="只有失败战局可以重试")
    record["status"] = "pending"
    record["attackerOut"] = {"samples": []}
    record["defenderOut"] = []
    state.battle_store.save(record)
    state.battle_store.delete_score(battle_id)
    scoring_glue.invalidate_leaderboard_cache()
    events = state.battle_store.list_events(battle_id)
    state.battle_store.save_event(
        events_api.build_event(
            battle_id,
            max((item["sequence"] for item in events), default=0) + 1,
            "battle.retry",
            "pending",
            {"topic": record["topic"], "difficulty": record["difficulty"]},
        )
    )
    payload = BattleRequest(
        difficulty=record["difficulty"],
        topic=record["topic"],
        rounds=record.get("rounds", 3),
    )
    battle_runner.schedule_battle_task(background_tasks, battle_id, payload)
    return BattleRecord.model_validate(record)


@app.post(
    "/battles/{battle_id}/cancel",
    dependencies=[Depends(security.rate_limit_dependency)],
    status_code=202,
    summary="取消运行中的战局",
    tags=["战局接口"],
)
def cancel_battle(battle_id: str, request: Request) -> BattleRecord:
    security.check_browser_or_api_auth(request)
    record = state.battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    if record["status"] in {"completed", "failed"}:
        raise HTTPException(status_code=409, detail="终态战局不能取消")
    state.battle_cancel_count += 1
    task = state.battle_tasks.get(battle_id)
    if task is not None and not task.done():
        state.cancel_requested.add(battle_id)
        task.cancel()
    battle_runner.mark_battle_terminal(
        battle_id, "battle.cancelled", "requested_by_client"
    )
    events_api.record_audit_event(
        "battle.cancel.requested",
        status="accepted",
        request_id=request.state.request_id,
        battle_id=battle_id,
        actor_role="operator",
        data={"taskTracked": task is not None and not task.done()},
    )
    updated = state.battle_store.get(battle_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    return BattleRecord.model_validate(updated)


@app.delete(
    "/battles/{battle_id}",
    dependencies=[Depends(security.rate_limit_dependency)],
    status_code=204,
    summary="删除已结束的战局",
    description="删除 completed 或 failed 战局及其事件；pending/running 战局必须先结束。",
    tags=["战局接口"],
)
def delete_battle(battle_id: str, request: Request) -> Response:
    security.check_browser_or_api_auth(request)
    record = state.battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    if record["status"] in {"pending", "running"}:
        raise HTTPException(status_code=409, detail="运行中的战局不能删除")
    state.battle_store.delete(battle_id)
    scoring_glue.invalidate_leaderboard_cache()
    return Response(status_code=204)


@app.get(
    "/battles",
    summary="查询历史战局",
    description="支持分页、难度和关键词筛选。",
    tags=["战局接口"],
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
        state.battle_store.count(difficulty=difficulty, status=status, query=q)
    )
    return [
        BattleRecord.model_validate(item)
        for item in state.battle_store.list(
            limit=limit, offset=offset, difficulty=difficulty, status=status, query=q
        )
    ]


@app.get(
    "/battles/{battle_id}/events",
    summary="查询战局回放事件",
    description="按事件序号升序分页返回已持久化的战局事件，可按类型、时间范围和事件内容检索。",
    tags=["战局回放"],
    dependencies=[Depends(security.read_auth_dependency)],
)
def get_battle_events(
    battle_id: str,
    response: Response,
    limit: int = Query(default=200, ge=1, le=1000, description="每页最多返回 1000 条"),
    after_sequence: int = Query(default=0, ge=0, description="返回序号大于此值的事件"),
    event_type: str | None = Query(default=None, min_length=1, max_length=64),
    from_time: datetime | None = Query(
        default=None, description="包含此时刻，ISO 8601"
    ),
    to_time: datetime | None = Query(default=None, description="包含此时刻，ISO 8601"),
    q: str | None = Query(
        default=None, max_length=200, description="搜索事件类型和原始事件数据"
    ),
) -> list[BattleEvent]:
    if state.battle_store.get(battle_id) is None:
        raise HTTPException(status_code=404, detail="战局不存在")

    def utc_iso(value: datetime | None) -> str | None:
        if value is None:
            return None
        normalized = (
            value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        )
        return normalized.isoformat()

    normalized_from = utc_iso(from_time)
    normalized_to = utc_iso(to_time)
    if normalized_from and normalized_to and normalized_from > normalized_to:
        raise HTTPException(status_code=422, detail="from_time 不能晚于 to_time")

    events, total = state.battle_store.query_events(
        battle_id,
        limit=limit,
        after_sequence=after_sequence,
        event_type=event_type,
        from_time=normalized_from,
        to_time=normalized_to,
        query=q,
    )
    has_more = len(events) > limit
    page = events[:limit]
    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Has-More"] = str(has_more).lower()
    if page:
        response.headers["X-Next-Sequence"] = str(page[-1]["sequence"])
    return [BattleEvent.model_validate(item) for item in page]


@app.get(
    "/battles/{battle_id}/replay",
    include_in_schema=False,
    dependencies=[Depends(security.read_auth_dependency)],
)
def replay_battle(battle_id: str) -> dict[str, Any]:
    if state.battle_store.get(battle_id) is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    return {
        "battleId": battle_id,
        "events": state.battle_store.list_events(battle_id),
        "mode": "replay",
    }


@app.get(
    "/battles/{battle_id}",
    summary="查询战局详情",
    description="按战局编号恢复攻击、防守和修复结果。",
    tags=["战局接口"],
)
def get_battle(battle_id: str) -> BattleRecord:
    record = state.battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    return BattleRecord.model_validate(record)


@app.get(
    "/battles/{battle_id}/rounds",
    summary="按回合聚合战局证据",
    tags=["战局回放"],
    dependencies=[Depends(security.read_auth_dependency)],
)
def get_battle_rounds(battle_id: str) -> dict[str, Any]:
    record = state.battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    events = state.battle_store.list_events(battle_id)
    grouped: dict[int, dict[str, Any]] = {}
    call_durations = {
        (event.get("data") or {}).get("correlationId"): (event.get("data") or {}).get(
            "durationMs"
        )
        for event in events
        if event.get("type") in {"agent.call.completed", "agent.call.failed"}
        and isinstance((event.get("data") or {}).get("correlationId"), str)
        and isinstance((event.get("data") or {}).get("durationMs"), (int, float))
    }

    def round_number(event: dict[str, Any]) -> int | None:
        value = event.get("data", {}).get("round")
        try:
            number = int(value)
        except TypeError, ValueError:
            return None
        return number if number > 0 else None

    for event in events:
        number = round_number(event)
        if number is None:
            continue
        item = grouped.setdefault(
            number,
            {
                "round": number,
                "status": "running",
                "sample": None,
                "caught": [],
                "risks": [],
                "fixed": [],
                "startedAt": None,
                "finishedAt": None,
                "durationMs": None,
            },
        )
        event_type = event.get("type")
        data = event.get("data") or {}
        if event_type == "round.started":
            item["status"] = "running"
            item["startedAt"] = event.get("createdAt")
        elif event_type == "attack.sample.generated":
            item["sample"] = data.get("sample")
            item["startedAt"] = item["startedAt"] or event.get("createdAt")
        elif event_type == "attack.compromised":
            item["compromised"] = {
                "targetVerified": data.get("targetVerified") is True,
                "verificationMode": data.get("verificationMode"),
                "simulated": data.get("simulated") is True,
                "evidence": data.get("evidence", []),
            }
        elif event_type in {"defense.completed", "round.completed"}:
            item["status"] = "completed"
            item["finishedAt"] = event.get("createdAt")
            if data.get("sample") is not None:
                item["sample"] = data.get("sample")
            for key in ("caught", "risks", "fixed"):
                if isinstance(data.get(key), list):
                    item[key] = data[key]
            if isinstance(data.get("arbiterReview"), dict):
                item["arbiterReview"] = data["arbiterReview"]
            if isinstance(data.get("durationMs"), (int, float)):
                item["durationMs"] = round(data["durationMs"])
            elif isinstance(
                call_durations.get(data.get("correlationId")), (int, float)
            ):
                item["durationMs"] = round(call_durations[data["correlationId"]])

    samples = record.get("attackerOut", {}).get("samples", [])
    defenses = record.get("defenderOut", [])
    for index, sample in enumerate(samples, start=1):
        item = grouped.setdefault(
            index,
            {
                "round": index,
                "status": "completed" if index <= len(defenses) else "pending",
                "sample": None,
                "caught": [],
                "risks": [],
                "fixed": [],
                "startedAt": None,
                "finishedAt": None,
                "durationMs": None,
            },
        )
        item["sample"] = item["sample"] if item["sample"] is not None else sample
        if index <= len(defenses):
            defense = defenses[index - 1] or {}
            for key in ("caught", "risks", "fixed"):
                if not item[key] and isinstance(defense.get(key), list):
                    item[key] = defense[key]
            if "arbiterReview" not in item and isinstance(
                defense.get("arbiterReview"), dict
            ):
                item["arbiterReview"] = defense["arbiterReview"]

    def duration_from_timestamps(item: dict[str, Any]) -> None:
        if (
            item["durationMs"] is not None
            or not item["startedAt"]
            or not item["finishedAt"]
        ):
            return
        try:
            started = datetime.fromisoformat(str(item["startedAt"]))
            finished = datetime.fromisoformat(str(item["finishedAt"]))
            item["durationMs"] = max(
                0, round((finished - started).total_seconds() * 1000)
            )
        except TypeError, ValueError:
            item["durationMs"] = None

    round_scores = {item["round"]: item for item in score_battle_rounds(record, events)}
    for item in grouped.values():
        duration_from_timestamps(item)
        defense = {key: item[key] for key in ("caught", "risks", "fixed")}
        item["layerInterceptions"] = derive_layer_interceptions(
            record["topic"], [defense]
        )
        scored_round = round_scores.get(item["round"])
        if scored_round is None:
            item["attacker"] = scoring_glue.insufficient_internal_score()["attacker"]
            item["defender"] = scoring_glue.insufficient_internal_score()["defender"]
            item["scores"] = {"attacker": None, "defender": None}
        else:
            item["attacker"] = scored_round["attacker"]
            item["defender"] = scored_round["defender"]
            item["scores"] = scored_round["scores"]
    stats = scoring_glue.battle_stats(record, events)
    # `total` reflects what was actually produced so callers never see a
    # mismatch (for example "5 of 5" while only three rounds exist). The
    # requested count is kept separately for diagnostics.
    requested_rounds = max(0, int(record.get("rounds") or len(grouped)))
    return {
        "total": len(grouped),
        "requestedRounds": requested_rounds,
        "rounds": [grouped[key] for key in sorted(grouped)],
        "stats": stats,
    }


def _report_summary_key(
    battle_id: str, record: dict[str, Any], events: list[dict[str, Any]]
) -> tuple[str, int, str]:
    """Cache key: a battle's summary only changes when events are appended."""
    return (battle_id, len(events), str(record.get("status") or ""))


def _prune_report_summary_cache(now: float) -> None:
    for key, (expires_at, _summary) in list(state.report_summary_cache.items()):
        if expires_at <= now:
            state.report_summary_cache.pop(key, None)
    while len(state.report_summary_cache) >= state.REPORT_SUMMARY_CACHE_MAX_ENTRIES:
        oldest = min(state.report_summary_cache.items(), key=lambda item: item[1][0])[0]
        state.report_summary_cache.pop(oldest, None)


async def _report_summary_for(
    battle_id: str, record: dict[str, Any], events: list[dict[str, Any]]
) -> dict[str, Any]:
    """Return the LLM report summary, reusing it while the event log is unchanged.

    The summary can cost one model call with retries, and the admin UI reads the
    report whenever a battle is opened, so an unchanged battle must not re-ask.
    """
    now = time.monotonic()
    key = _report_summary_key(battle_id, record, events)
    cached = state.report_summary_cache.get(key)
    if cached is not None and cached[0] > now:
        return cached[1]
    state.report_summary_cache.pop(key, None)
    summary = await summarize_report(record, events)
    _prune_report_summary_cache(now)
    state.report_summary_cache[key] = (
        now + state.REPORT_SUMMARY_CACHE_TTL_SECONDS,
        summary,
    )
    return summary


@app.get(
    "/battles/{battle_id}/report",
    include_in_schema=False,
    dependencies=[Depends(security.read_auth_dependency)],
)
@app.get(
    "/reports/{battle_id}",
    summary="查看或下载战报",
    description="默认返回 JSON；将 format 设置为 markdown 可下载 Markdown 战报。",
    tags=["战报接口"],
    dependencies=[Depends(security.read_auth_dependency)],
)
async def battle_report(
    battle_id: str,
    format: Literal["json", "markdown"] = Query(default="json"),
) -> Any:
    record = state.battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    events = state.battle_store.list_events(battle_id)
    report_summary = await _report_summary_for(battle_id, record, events)
    if format == "markdown":
        stored_internal_score = state.battle_store.get_score(battle_id)
        return PlainTextResponse(
            build_markdown_report(
                record,
                events,
                stored_internal_score
                if stored_internal_score is not None
                else scoring_glue.insufficient_internal_score(),
                scoring_glue.role_scores(record),
                report_summary,
            ),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{battle_id}.md"'},
        )
    attacker_score, defender_score = scoring_glue.role_scores(record)
    stored_internal_score = state.battle_store.get_score(battle_id)
    return {
        "battle": record,
        "events": events,
        "scores": {"attacker": attacker_score, "defender": defender_score},
        "internalScore": stored_internal_score
        if stored_internal_score is not None
        else scoring_glue.insufficient_internal_score(),
        "summary": report_summary,
    }


@app.get(
    "/battles/{battle_id}/score",
    summary="查看战局内部运行质量评分",
    description="返回战局完成后持久化的可追溯运行评分，不代表攻击成功率或检测准确率；缺少快照时返回证据不足。",
    tags=["评分接口"],
    dependencies=[Depends(security.read_auth_dependency)],
)
def battle_internal_score(battle_id: str) -> dict[str, Any]:
    record = state.battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    stored = state.battle_store.get_score(battle_id)
    return stored if stored is not None else scoring_glue.insufficient_internal_score()


@app.get(
    "/internal-scores",
    summary="查看近期战局内部运行质量评分",
    description="聚合最近战局的运行质量评分；缺少逐调用事件的历史战局单独标记为证据不足。",
    tags=["评分接口"],
    dependencies=[Depends(security.read_auth_dependency)],
)
def internal_scores(limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
    items = []
    records = state.battle_store.list(limit=limit)
    stored_scores = state.battle_store.list_scores([record["id"] for record in records])
    for record in records:
        score = (
            stored_scores.get(record["id"])
            or scoring_glue.insufficient_internal_score()
        )
        items.append(
            {
                "battleId": record["id"],
                "topic": record["topic"],
                "difficulty": record["difficulty"],
                "status": record["status"],
                "createdAt": record["createdAt"],
                **score,
            }
        )
    attacker_scores = [
        item["attacker"]["score"]
        for item in items
        if isinstance(item["attacker"]["score"], (int, float))
    ]
    defender_scores = [
        item["defender"]["score"]
        for item in items
        if isinstance(item["defender"]["score"], (int, float))
    ]
    return {
        "version": SCORING_VERSION,
        "attacker": {
            "scoredBattleCount": len(attacker_scores),
            "insufficientEvidenceCount": len(items) - len(attacker_scores),
            "averageScore": round(sum(attacker_scores) / len(attacker_scores), 1)
            if attacker_scores
            else None,
        },
        "defender": {
            "scoredBattleCount": len(defender_scores),
            "insufficientEvidenceCount": len(items) - len(defender_scores),
            "averageScore": round(sum(defender_scores) / len(defender_scores), 1)
            if defender_scores
            else None,
        },
        "items": items,
    }


@app.get(
    "/leaderboard",
    summary="查看攻防排行榜",
    description="返回攻击方和防守方的累计得分与对抗轮次。",
    tags=["统计接口"],
    dependencies=[Depends(security.read_auth_dependency)],
)
def leaderboard() -> dict[str, Any]:
    now = time.monotonic()
    if state.leaderboard_cache and now - state.leaderboard_cache[0] < 2:
        return state.leaderboard_cache[1]
    cached = state.redis_cache.get_json("agent-attack-lab:v1:leaderboard")
    if isinstance(cached, dict) and isinstance(cached.get("items"), list):
        state.leaderboard_cache = (now, cached)
        return cached
    attacker_score = defender_score = 0
    rounds = 0
    for record in state.battle_store.list(limit=100000):
        attack_points, defend_points = scoring_glue.role_scores(record)
        attacker_score += attack_points
        defender_score += defend_points
        rounds += len(record["attackerOut"].get("samples", []))
    result = {
        "items": [
            {"agent": "attacker", "score": attacker_score, "rounds": rounds},
            {"agent": "defender", "score": defender_score, "rounds": rounds},
        ],
    }
    state.leaderboard_cache = (now, result)
    state.redis_cache.set_json("agent-attack-lab:v1:leaderboard", result)
    return result


@app.get(
    "/battles/{battle_id}/events/stream",
    include_in_schema=False,
    dependencies=[Depends(security.read_auth_dependency)],
)
async def event_stream(
    battle_id: str, follow: bool = Query(default=False)
) -> StreamingResponse:
    if await asyncio.to_thread(state.battle_store.get, battle_id) is None:
        raise HTTPException(status_code=404, detail="战局不存在")

    async def generate() -> Any:
        after_sequence = 0
        attempts = 0
        poll_interval = 0.1
        while attempts < (60 if follow else 1):
            events = await asyncio.to_thread(
                state.battle_store.list_events_after, battle_id, after_sequence
            )
            for event in events:
                yield f"id: {event['id']}\nevent: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                after_sequence = event["sequence"]
            terminal = any(
                event["type"] in {"battle.completed", "battle.failed"}
                for event in events
            )
            if not follow or terminal:
                break
            attempts += 1
            await asyncio.sleep(poll_interval)
            poll_interval = min(poll_interval * 2, 0.5)

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.websocket("/ws/battles/{battle_id}")
async def battle_websocket(websocket: WebSocket, battle_id: str) -> None:
    if config.protect_read_routes and config.api_key:
        supplied_key = websocket.headers.get("x-api-key") or websocket.query_params.get(
            "api_key"
        )
        if supplied_key != config.api_key:
            await websocket.close(code=4401, reason="缺少或无效的 API 密钥")
            return
    if await asyncio.to_thread(state.battle_store.get, battle_id) is None:
        await websocket.close(code=4404, reason="战局不存在")
        return
    await websocket.accept()
    sent = 0
    try:
        for _ in range(60):
            events = await asyncio.to_thread(
                state.battle_store.list_events_after, battle_id, sent
            )
            for event in events:
                await websocket.send_json(event)
                sent = event["sequence"]
            if any(
                event["type"] in {"battle.completed", "battle.failed"}
                for event in events
            ):
                await websocket.send_json(
                    {"type": "stream.completed", "battleId": battle_id}
                )
                break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        return
    finally:
        if websocket.client_state.name == "CONNECTED":
            await websocket.close()


@app.post(
    "/agent/attack",
    dependencies=[
        Depends(security.api_key_dependency),
        Depends(security.rate_limit_dependency),
    ],
    include_in_schema=False,
)
def agent_attack(payload: AttackRequest) -> dict[str, Any]:
    return attack(payload)


@app.post(
    "/agent/defend",
    dependencies=[
        Depends(security.api_key_dependency),
        Depends(security.rate_limit_dependency),
    ],
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
    await DefaultHandlers.start(command, task)
    command_params = command.commandParams or {}
    payload: dict[str, Any] = command_params.get("payload", {})
    if not payload:
        try:
            parsed = json.loads(_command_text(command))
            if isinstance(parsed, dict):
                payload = parsed
        except TypeError, ValueError:
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
    dependencies=[
        Depends(security.api_key_dependency),
        Depends(security.rate_limit_dependency),
    ],
    include_in_schema=False,
)
async def rpc(request: Request) -> dict[str, Any]:
    """JSON-RPC endpoint supporting both AIP ``rpc`` and simple agent methods."""
    body = await request.json()
    if body.get("method") == "rpc":
        response = await handle_rpc_request(
            request, _aip_handlers, **_aip_server_options
        )
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
    except Exception as exc:  # noqa: BLE001 - JSON-RPC boundary must normalize all validation errors.
        return {
            "jsonrpc": "2.0",
            "id": parsed_request.id,
            "error": {"code": -32602, "message": "Invalid params", "data": str(exc)},
        }
    return {"jsonrpc": "2.0", "id": parsed_request.id, "result": result}


# --- Routers ----------------------------------------------------------------

app.include_router(routers.meta.router)
