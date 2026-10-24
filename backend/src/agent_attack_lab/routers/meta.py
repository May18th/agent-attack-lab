"""Service metadata routes: landing payload, dashboard page, health, metrics.

Everything here is read-only and unauthenticated except ``/metrics``, which is
guarded by ``security.metrics_auth_dependency``.
"""

from __future__ import annotations

import hashlib
import json
import time
from html import escape as escape_html
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from agent_attack_lab import config, pages, security, state
from agent_attack_lab.acp_agents import rpc_metrics
from agent_attack_lab.agent_logic import local_rule_case_count
from agent_attack_lab.external_cases import query_external_cases
from agent_attack_lab.owasp_rules import OWASP_LLM_CATEGORIES

router = APIRouter()


@router.get("/", include_in_schema=False)
def index() -> dict[str, Any]:
    return {
        "service": "智能体攻防实验室",
        "status": "ok",
        "endpoints": [
            "/health",
            "/metrics",
            "/battles",
            "/battles/{id}/events",
            "/battles/{id}/report",
            "/leaderboard",
            "/agent/attack",
            "/agent/defend",
            "/rpc",
            "/docs",
            "/external-cases",
            "/battles/{id}/audit",
        ],
        "note": "当前提供 JSON-RPC 2.0 和兼容的 HTTP JSON 接口；平台审核通过并下发证书后再启用 mTLS。",
    }


@router.get("/dashboard", response_class=HTMLResponse, include_in_schema=False)
def dashboard(
    request: Request,
    topic: str | None = Query(default=None, max_length=200),
    difficulty: Literal["low", "mid", "high"] | None = Query(default=None),
) -> str:
    try:
        security.check_browser_or_api_auth(request)
    except HTTPException as exc:
        if exc.status_code == 401 and config.browser_password:
            destination = request.url.path
            if request.url.query:
                destination += "?" + request.url.query
            return RedirectResponse(
                url="/login?next=" + quote(destination, safe=""),
                status_code=303,
                headers={"Cache-Control": "no-store"},
            )
        raise
    topic_value = escape_html(topic or "通用安全测试", quote=True)
    selected_difficulty = difficulty or "mid"
    return pages.dashboard_html(
        topic_value=topic_value, selected_difficulty=selected_difficulty
    )


@router.get("/health", summary="服务健康检查", tags=["核心接口"])
def health(request: Request) -> dict[str, Any]:
    storage_status = "ok"
    try:
        state.battle_store.count()
    except Exception:  # noqa: BLE001 - health must report degraded storage instead of failing.
        storage_status = "error"
    return {
        "status": "ok" if storage_status == "ok" else "degraded",
        "service": "智能体攻防实验室",
        "version": config.service_version,
        "uptimeSeconds": round(time.monotonic() - state.started_at, 2),
        "storage": storage_status,
        "requestId": request.state.request_id,
    }


@router.get(
    "/metrics",
    include_in_schema=False,
    dependencies=[Depends(security.metrics_auth_dependency)],
)
def metrics() -> dict[str, Any]:
    average_latency = (
        state.request_total_duration_ms / state.request_count
        if state.request_count
        else 0
    )
    acp = rpc_metrics()
    return {
        "service": "智能体攻防实验室",
        "uptimeSeconds": round(time.monotonic() - state.started_at, 2),
        "requests": state.request_count,
        "errors": state.request_errors,
        "averageLatencyMs": round(average_latency, 2),
        "maxLatencyMs": round(state.request_max_duration_ms, 2),
        "rateLimited": state.rate_limited_count,
        "rateLimitPerMinute": config.rate_limit_per_minute,
        "protectReadRoutes": config.protect_read_routes,
        "eventDataMaxBytes": config.event_data_max_bytes,
        "recoveryTasks": len(state.recovery_tasks),
        "activeBattleTasks": len(state.battle_tasks),
        "battleTimeouts": state.battle_timeout_count,
        "battleCancellations": state.battle_cancel_count,
        "acpRetries": acp["retries"],
        "acpTimeouts": acp["timeouts"],
        "auditEvents": state.battle_store.count_audit_events(),
        "battles": state.battle_store.count(),
        "events": state.battle_store.count_events(),
    }


@router.get(
    "/dashboard/summary",
    summary="查询后台统计摘要",
    description=(
        "历史业务指标从当前已保存战局聚合；Agent/ACP 调用指标仅统计有 agent.call.completed/failed 事件的调用，"
        "不把战局数等同于调用次数。reportedLlmResultCount 表示 Partner 返回来源字段声明为 acp-llm，"
        "并非独立模型提供方证明；acpSuccessCount 表示 AIP 结果成功返回，不代表真实目标已验证。"
    ),
    tags=["统计接口"],
)
def dashboard_summary() -> dict[str, int]:
    cache_key = "agent-attack-lab:v2:dashboard-summary"
    cached = state.redis_cache.get_json(cache_key)
    if isinstance(cached, dict):
        return {str(key): int(value) for key, value in cached.items()}
    result = {
        **state.battle_store.dashboard_summary(),
        "ruleLibraryCaseCount": local_rule_case_count(),
        "owaspLlmRuleCount": len(OWASP_LLM_CATEGORIES),
    }
    state.redis_cache.set_json(cache_key, result)
    return result


@router.get(
    "/external-cases",
    summary="查询外部安全案例",
    description=(
        "只读查询已导入的外部安全案例；每条记录保留来源、版本和内容哈希，"
        "不把外部事实当作本项目战局或攻击样本。"
    ),
    tags=["外部案例"],
)
def list_external_cases(
    q: str | None = Query(
        default=None, max_length=200, description="按 CVE、标题、厂商或产品检索"
    ),
    vendor: str | None = Query(default=None, max_length=200),
    product: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    normalized = {
        "q": q.strip() if q else None,
        "vendor": vendor.strip() if vendor else None,
        "product": product.strip() if product else None,
        "limit": limit,
        "offset": offset,
    }
    cache_key = (
        "agent-attack-lab:v1:external-cases:"
        + hashlib.sha256(
            json.dumps(normalized, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
    )
    cached = state.redis_cache.get_json(cache_key)
    if isinstance(cached, dict):
        return cached
    result = query_external_cases(
        config.external_cases_database,
        query=normalized["q"],
        vendor=normalized["vendor"],
        product=normalized["product"],
        limit=limit,
        offset=offset,
    )
    if result.get("available"):
        state.redis_cache.set_json(cache_key, result, ttl_seconds=300)
    return result
