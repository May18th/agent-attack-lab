"""Admin resources: attack samples, defence rules, rule candidates, audit log.

Every mutating call writes an audit event through ``admin_write_audit`` before
touching storage, so the trail exists even if the write then fails.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, Response

from agent_attack_lab import events as events_api
from agent_attack_lab import security, state
from agent_attack_lab.agents.rule_discovery import suggest_rule_candidate
from agent_attack_lab.models import (
    AdminRuleRequest,
    AdminSampleRequest,
    RuleCandidateRequest,
)

router = APIRouter()


def admin_write_audit(request: Request, event_type: str, data: dict[str, Any]) -> None:
    events_api.record_audit_event(
        event_type,
        status="accepted",
        request_id=request.state.request_id,
        actor_role="admin",
        data=data,
    )


@router.get("/admin/samples", summary="查询管理员攻击样本库", tags=["管理员资源"])
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


@router.post(
    "/admin/samples", status_code=201, summary="新增管理员攻击样本", tags=["管理员资源"]
)
def create_admin_sample(
    payload: AdminSampleRequest, request: Request
) -> dict[str, Any]:
    security.check_browser_or_api_auth(request)
    item = state.battle_store.save_admin_sample(payload.model_dump())
    admin_write_audit(
        request,
        "admin.sample.created",
        {"sampleId": item["id"], "topic": item["topic"]},
    )
    return item


@router.patch(
    "/admin/samples/{sample_id}", summary="编辑管理员攻击样本", tags=["管理员资源"]
)
def update_admin_sample(
    sample_id: str, payload: AdminSampleRequest, request: Request
) -> dict[str, Any]:
    security.check_browser_or_api_auth(request)
    item = state.battle_store.update_admin_sample(sample_id, payload.model_dump())
    if item is None:
        raise HTTPException(status_code=404, detail="攻击样本不存在")
    admin_write_audit(request, "admin.sample.updated", {"sampleId": sample_id})
    return item


@router.delete(
    "/admin/samples/{sample_id}",
    status_code=204,
    summary="删除管理员攻击样本",
    tags=["管理员资源"],
)
def delete_admin_sample(sample_id: str, request: Request) -> Response:
    security.check_browser_or_api_auth(request)
    if not state.battle_store.delete_admin_sample(sample_id):
        raise HTTPException(status_code=404, detail="攻击样本不存在")
    admin_write_audit(request, "admin.sample.deleted", {"sampleId": sample_id})
    return Response(status_code=204)


@router.get("/admin/rules", summary="查询管理员防守规则库", tags=["管理员资源"])
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


@router.post(
    "/admin/rules", status_code=201, summary="新增管理员防守规则", tags=["管理员资源"]
)
def create_admin_rule(payload: AdminRuleRequest, request: Request) -> dict[str, Any]:
    security.check_browser_or_api_auth(request)
    item = state.battle_store.save_admin_rule(payload.model_dump())
    admin_write_audit(
        request, "admin.rule.created", {"ruleId": item["id"], "name": item["name"]}
    )
    return item


@router.post(
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
    admin_write_audit(
        request,
        "admin.rule.candidate.proposed",
        {
            "topic": payload.topic,
            "agentSource": result.get("agentSource"),
            "requiresHumanApproval": True,
        },
    )
    return result


@router.patch(
    "/admin/rules/{rule_id}", summary="编辑管理员防守规则", tags=["管理员资源"]
)
def update_admin_rule(
    rule_id: str, payload: AdminRuleRequest, request: Request
) -> dict[str, Any]:
    security.check_browser_or_api_auth(request)
    item = state.battle_store.update_admin_rule(rule_id, payload.model_dump())
    if item is None:
        raise HTTPException(status_code=404, detail="防守规则不存在")
    admin_write_audit(request, "admin.rule.updated", {"ruleId": rule_id})
    return item


@router.delete(
    "/admin/rules/{rule_id}",
    status_code=204,
    summary="删除管理员防守规则",
    tags=["管理员资源"],
)
def delete_admin_rule(rule_id: str, request: Request) -> Response:
    security.check_browser_or_api_auth(request)
    if not state.battle_store.delete_admin_rule(rule_id):
        raise HTTPException(status_code=404, detail="防守规则不存在")
    admin_write_audit(request, "admin.rule.deleted", {"ruleId": rule_id})
    return Response(status_code=204)


@router.get("/admin/audit-logs", summary="查询管理员审计日志", tags=["管理员资源"])
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
