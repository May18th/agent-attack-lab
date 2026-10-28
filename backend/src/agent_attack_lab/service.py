from __future__ import annotations

import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import (
    FastAPI,
    Request,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from agent_attack_lab import (
    amp,
    battle_runner,
    config,
    routers,
    scoring_glue,
    state,
)
from agent_attack_lab import events as events_api
from agent_attack_lab.models import (
    BattleRequest,
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
    # AMP 心跳：让本服务在梧桐平台保持 alive=online（未开启时为空操作）。
    await amp.start_from_env()
    try:
        yield
    finally:
        await amp.stop_active()
        pending = list(state.recovery_tasks)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        state.battle_store.close()
        state.redis_cache.close()


app.router.lifespan_context = _lifespan


# --- Routers ----------------------------------------------------------------

app.include_router(routers.meta.router)
app.include_router(routers.auth.router)
app.include_router(routers.admin.router)
app.include_router(routers.reports.router)
app.include_router(routers.scores.router)
app.include_router(routers.battles.router)
app.include_router(routers.rpc.router)
app.include_router(routers.survey.router)
