"""Battle lifecycle: create, retry, cancel, delete, read, stream, replay, audit.

Two execution paths live here. ``create_battle`` can run synchronously in the
request (default) or hand the work to a background task; ``retry_battle`` always
schedules. Both call into ``battle_runner``, which owns the phase-by-phase
pipeline and appends events as it goes so the SSE / WebSocket followers see the
battle progress instead of a final blob.

``IDEMPOTENCY_KEY`` reuse is checked before a battle is created, and the
fingerprint of the request body decides whether a repeated key is a replay of the
same request or a conflict.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import StreamingResponse

from agent_attack_lab import (
    battle_runner,
    battle_timeline,
    config,
    scoring_glue,
    security,
    state,
)
from agent_attack_lab import events as events_api
from agent_attack_lab.acp_agents import ACPAgentError
from agent_attack_lab.acp_agents import is_configured as acp_agent_configured
from agent_attack_lab.agents.arbiter import review_round
from agent_attack_lab.battle_audit import audit_battle
from agent_attack_lab.layer_interceptions import derive_layer_interceptions
from agent_attack_lab.models import BattleEvent, BattleRecord, BattleRequest
from agent_attack_lab.scoring import score_battle_rounds
from agent_attack_lab.target_verify import (
    aggregate_verdict,
    configured_verify_mode,
    verify_round_live,
)

router = APIRouter()


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


@router.get(
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


@router.post(
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
        battle_runner.schedule_battle_task(battle_id, payload)
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
            round_number=0,
            stage_id="A2",
        )
        for index, sample in enumerate(attack_result["samples"], start=1):
            add_event(
                "attack.sample.generated",
                "completed",
                {
                    "round": index,
                    "sample": sample,
                    "attackerSource": attacker_source,
                    "correlationId": attack_call_id,
                },
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
        for index, sample in enumerate(attack_result["samples"], start=1):
            add_event(
                "round.started",
                "running",
                {
                    "round": index,
                    "rounds": payload.rounds,
                    "structuredTimelineVersion": "v2.0",
                    "defenderSource": "acp-pending"
                    if acp_agent_configured("defender")
                    else "local-rule",
                },
            )
            battle_timeline.emit_attack_stages(
                add_event,
                round_number=index,
                total_rounds=payload.rounds,
                difficulty=payload.difficulty,
                topic=payload.topic,
                sample=sample,
                previous_sample=attack_result["samples"][index - 2]
                if index > 1
                else None,
                correlation_id=attack_call_id,
            )
            (
                defense,
                defender_source,
                defense_call_id,
            ) = await battle_runner.tracked_agent_call(
                battle_id=battle_id,
                role="defender",
                invoke=lambda correlation_id, current_sample=sample: (
                    battle_runner.battle_defend(
                        current_sample, correlation_id=correlation_id
                    )
                ),
                add_event=add_event,
                round_number=index,
                stage_id="DEFENSE",
            )
            verification = await verify_round_live(
                sample, defense, mode=verification_mode
            )
            verifications.append(verification)
            for key in ("attackSuccess", "defenseSuccess"):
                if isinstance(verification.get(key), bool):
                    defense[key] = verification[key]
            arbiter_review = await review_round(sample, defense, verification)
            defense["arbiterReview"] = arbiter_review
            defense_results.append(defense)
            classification = battle_timeline.emit_defense_and_arbiter_stages(
                add_event,
                round_number=index,
                topic=payload.topic,
                defense=defense,
                verification=verification,
                arbiter_review=arbiter_review,
                correlation_id=defense_call_id,
            )
            battle_timeline.emit_attack_review(
                add_event,
                round_number=index,
                classification=classification,
                arbiter_review=arbiter_review,
                correlation_id=attack_call_id,
            )
            add_event(
                "round.settled",
                "completed",
                {
                    "round": index,
                    "stageId": "FINAL",
                    "classification": classification,
                    "structuredTimelineVersion": "v2.0",
                },
            )
            round_data = {
                "round": index,
                "sample": sample,
                "caught": defense["caught"],
                "risks": defense["risks"],
                "fixed": defense["fixed"],
                "defenderSource": defender_source,
                "analysisMode": defense.get("analysisMode"),
                "verificationStatus": defense.get("verificationStatus"),
                "scopeNotice": defense.get("scopeNotice"),
                "arbiterReview": arbiter_review,
                "correlationId": defense_call_id,
                "classification": classification,
                "structuredTimelineVersion": "v2.0",
            }
            for key in ("attackSuccess", "defenseSuccess"):
                if isinstance(defense.get(key), bool):
                    round_data[key] = defense[key]
            if isinstance(defense.get("safeControl"), dict):
                round_data["safeControl"] = defense["safeControl"]
            add_event("round.completed", "completed", round_data)
            # 只有真正判定攻破时才记 compromised；被拦截（attackSuccess=False）
            # 同样是"已验证"，但事件语义不同，混在一起会让回放显示成"已攻破"。
            if verification["verified"] and verification.get("attackSuccess") is True:
                add_event(
                    "attack.compromised",
                    "completed",
                    {
                        "round": index,
                        "targetAssetId": verification.get("targetAssetId"),
                        "targetVerified": True,
                        "verificationMode": verification["mode"],
                        "simulated": verification["simulated"],
                        "attackSuccess": verification.get("attackSuccess"),
                        "evidence": verification["evidence"],
                        "correlationId": defense_call_id,
                    },
                )
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
            "compromisedRounds": sum(
                1 for item in verifications if item.get("attackSuccess") is True
            ),
            "interceptedRounds": sum(
                1
                for item in defense_results
                if item.get("attackSuccess") is False
                and item.get("defenseSuccess") is True
            ),
            "verificationMode": verification_mode,
        },
    )
    for event in events:
        state.battle_store.save_event(event)
    scoring_glue.persist_internal_score(record.model_dump())
    return record


@router.post(
    "/battles/{battle_id}/retry",
    dependencies=[Depends(security.rate_limit_dependency)],
    status_code=202,
    summary="重试失败战局",
    description="将失败战局重置为等待中并重新执行；需要配置 API Key 时沿用创建战局的密钥。",
    tags=["战局接口"],
)
async def retry_battle(
    battle_id: str,
    request: Request,
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
    battle_runner.schedule_battle_task(battle_id, payload)
    return BattleRecord.model_validate(record)


@router.post(
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


@router.delete(
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


@router.get(
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


@router.get(
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


@router.get(
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


@router.get(
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


@router.get(
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
            for key in ("attackSuccess", "defenseSuccess"):
                if isinstance(data.get(key), bool):
                    item[key] = data[key]
            if isinstance(data.get("safeControl"), dict):
                item["safeControl"] = data["safeControl"]
            if isinstance(data.get("durationMs"), (int, float)):
                item["durationMs"] = round(data["durationMs"])
            elif isinstance(
                call_durations.get(data.get("correlationId")), (int, float)
            ):
                item["durationMs"] = round(call_durations[data["correlationId"]])
        if event_type == "safe_control" and isinstance(data.get("status"), str):
            item["safeControl"] = data

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
            for key in ("attackSuccess", "defenseSuccess"):
                if key not in item and isinstance(defense.get(key), bool):
                    item[key] = defense[key]
            if "safeControl" not in item and isinstance(
                defense.get("safeControl"), dict
            ):
                item["safeControl"] = defense["safeControl"]

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


@router.get(
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


@router.websocket("/ws/battles/{battle_id}")
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
