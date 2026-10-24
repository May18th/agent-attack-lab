from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

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
    Depends,
    FastAPI,
    Request,
)
from fastapi.middleware.cors import CORSMiddleware
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
from agent_attack_lab.agent_logic import (
    AttackRequest,
    DefendRequest,
    attack,
    defend,
)
from agent_attack_lab.aip_compat import server_identity_options
from agent_attack_lab.models import (
    BattleRequest,
    JsonRpcRequest,
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
app.include_router(routers.auth.router)
app.include_router(routers.admin.router)
app.include_router(routers.reports.router)
app.include_router(routers.scores.router)
app.include_router(routers.battles.router)
