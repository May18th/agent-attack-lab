"""Battle execution pipeline.

Runs a battle in observable stages (attack -> per-round defence -> verdict) and
writes every transition to the event store as it happens, so a client can follow
along over SSE or the WebSocket stream.

Depends on ``scoring_glue`` for terminal side effects; ``BattleRequest`` is only
imported for type checking (the module works on the payload duck-typed) which
keeps the dependency direction one-way: routers -> battle_runner -> scoring_glue.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any, Literal

from fastapi import BackgroundTasks

from agent_attack_lab import config, scoring_glue, state
from agent_attack_lab import events as events_api
from agent_attack_lab.acp_agents import (
    ACPAgentError,
    call_attacker,
    call_defender,
)
from agent_attack_lab.acp_agents import (
    is_configured as acp_agent_configured,
)
from agent_attack_lab.agent_logic import AttackRequest, DefendRequest, attack, defend
from agent_attack_lab.agents.knowledge import (
    build_attacker_knowledge,
    build_defender_knowledge,
)
from agent_attack_lab.layer_interceptions import derive_layer_interceptions
from agent_attack_lab.target_verify import (
    aggregate_verdict,
    configured_verify_mode,
    verify_round,
)

if TYPE_CHECKING:
    from agent_attack_lab.models import BattleRequest

logger = logging.getLogger(__name__)


def mark_battle_terminal(battle_id: str, event_type: str, reason: str) -> None:
    record = state.battle_store.get(battle_id)
    if record is None or record["status"] in {"completed", "failed"}:
        return
    record["status"] = "failed"
    state.battle_store.save(record)
    events = state.battle_store.list_events(battle_id)
    state.battle_store.save_event(
        events_api.build_event(
            battle_id,
            max((item["sequence"] for item in events), default=0) + 1,
            event_type,
            "failed",
            {"reason": reason},
        )
    )
    events_api.record_audit_event(
        event_type,
        status="failed",
        battle_id=battle_id,
        actor_role="system",
        data={"reason": reason},
    )
    scoring_glue.persist_internal_score(record)
    scoring_glue.invalidate_leaderboard_cache()


async def run_battle_with_tracking(battle_id: str, payload: BattleRequest) -> None:
    current = asyncio.current_task()
    if current is not None:
        state.battle_tasks[battle_id] = current
    try:
        await asyncio.wait_for(
            run_battle_async(battle_id, payload), timeout=config.battle_timeout_seconds
        )
    except TimeoutError:
        state.battle_timeout_count += 1
        mark_battle_terminal(battle_id, "battle.timeout", "execution_timeout")
    except asyncio.CancelledError:
        if battle_id in state.cancel_requested:
            state.cancel_requested.discard(battle_id)
            mark_battle_terminal(battle_id, "battle.cancelled", "requested_by_client")
            return
        raise
    finally:
        state.battle_tasks.pop(battle_id, None)


def schedule_battle_task(
    background_tasks: BackgroundTasks, battle_id: str, payload: BattleRequest
) -> None:
    background_tasks.add_task(run_battle_with_tracking, battle_id, payload)


async def battle_attack(
    payload: BattleRequest, *, correlation_id: str
) -> tuple[dict[str, Any], str]:
    agent_payload = payload.model_dump()
    knowledge = build_attacker_knowledge(
        state.battle_store.list_admin_samples(limit=200, offset=0),
        topic=payload.topic,
    )
    if knowledge["records"]:
        agent_payload["_knowledgeContext"] = knowledge
    result = await call_attacker(agent_payload, correlation_id=correlation_id)
    source = "local-rule"
    if result is None:
        result = attack(AttackRequest.model_validate(payload.model_dump()))
        result["agentMode"] = "local-rule"
    else:
        source = result.pop("agentSource", None) or (
            "acp-llm" if result.get("agentMode") == "llm" else "acp-rule-fallback"
        )
    return {**result, "agentSource": source}, source


async def battle_defend(
    sample: dict[str, Any], *, correlation_id: str
) -> tuple[dict[str, Any], str]:
    topic = str(sample.get("topic") or "")
    knowledge = build_defender_knowledge(
        state.battle_store.list_admin_rules(limit=200, offset=0),
        topic=topic,
    )
    agent_payload: dict[str, Any] = {"sample": sample}
    if knowledge["records"]:
        agent_payload["_knowledgeContext"] = knowledge
    result = await call_defender(agent_payload, correlation_id=correlation_id)
    source = "local-rule"
    if result is None:
        result = defend(DefendRequest(sample=sample))
        result["agentMode"] = "local-rule"
    else:
        source = result.pop("agentSource", None) or (
            "acp-llm" if result.get("agentMode") == "llm" else "acp-rule-fallback"
        )
    return {**result, "agentSource": source}, source


async def tracked_agent_call(
    *,
    battle_id: str,
    role: Literal["attacker", "defender"],
    invoke: Callable[[str], Awaitable[tuple[dict[str, Any], str]]],
    add_event: Callable[[str, str, dict[str, Any]], None],
) -> tuple[dict[str, Any], str, str]:
    correlation_id = f"call-{uuid.uuid4()}"
    dispatch_mode = "acp" if acp_agent_configured(role) else "local"
    event_data: dict[str, Any] = {
        "correlationId": correlation_id,
        "agentRole": role,
        "dispatchMode": dispatch_mode,
    }
    expected_aic = os.getenv(
        f"AGENT_{role.upper()}_EXPECTED_AIC",
        os.getenv("AGENT_AIP_EXPECTED_PARTNER_AIC", ""),
    ).strip()
    if expected_aic:
        event_data["expectedPeerAic"] = expected_aic

    started = time.monotonic()
    add_event("agent.call.started", "running", event_data)
    events_api.record_audit_event(
        "agent.call.started",
        status="running",
        battle_id=battle_id,
        correlation_id=correlation_id,
        actor_role=role,
        data=event_data,
    )
    try:
        result, source = await invoke(correlation_id)
    except Exception as exc:
        failure_data = {
            **event_data,
            "durationMs": round((time.monotonic() - started) * 1000),
            "errorType": type(exc).__name__,
        }
        add_event(
            "agent.call.failed",
            "failed",
            failure_data,
        )
        events_api.record_audit_event(
            "agent.call.failed",
            status="failed",
            battle_id=battle_id,
            correlation_id=correlation_id,
            actor_role=role,
            data=failure_data,
        )
        logger.warning(
            "Battle %s %s call failed (correlation_id=%s, error_type=%s)",
            battle_id,
            role,
            correlation_id,
            type(exc).__name__,
        )
        raise

    completed_data = {
        **event_data,
        "durationMs": round((time.monotonic() - started) * 1000),
        "resultSource": source,
    }
    add_event(
        "agent.call.completed",
        "completed",
        completed_data,
    )
    events_api.record_audit_event(
        "agent.call.completed",
        status="completed",
        battle_id=battle_id,
        correlation_id=correlation_id,
        actor_role=role,
        data=completed_data,
    )
    return result, source, correlation_id


async def run_battle_async(battle_id: str, payload: BattleRequest) -> None:
    """Run a battle in stages so clients can observe its event stream."""
    record = await asyncio.to_thread(state.battle_store.get, battle_id)
    if record is None:
        return
    events = await asyncio.to_thread(state.battle_store.list_events, battle_id)
    sequence = max((event["sequence"] for event in events), default=0) + 1
    verification_mode = configured_verify_mode()
    verifications: list[dict[str, Any]] = []

    def add_event(event_type: str, status: str, data: dict[str, Any]) -> None:
        nonlocal sequence
        event = events_api.build_event(battle_id, sequence, event_type, status, data)
        sequence += 1
        state.battle_store.save_event(event)

    try:
        record["status"] = "running"
        state.battle_store.save(record)
        add_event(
            "attack.started",
            "running",
            {
                "topic": payload.topic,
                "attackerSource": "acp-pending"
                if acp_agent_configured("attacker")
                else "local-rule",
            },
        )
        await asyncio.sleep(0.8)
        attack_result, attacker_source, attack_call_id = await tracked_agent_call(
            battle_id=battle_id,
            role="attacker",
            invoke=lambda correlation_id: battle_attack(
                payload, correlation_id=correlation_id
            ),
            add_event=add_event,
        )
        record["attackerOut"] = attack_result
        state.battle_store.save(record)
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
            await asyncio.sleep(0.35)
        add_event(
            "attack.completed",
            "completed",
            {
                "sampleCount": len(attack_result["samples"]),
                "attackerSource": attacker_source,
                "correlationId": attack_call_id,
            },
        )

        defender_results: list[dict[str, Any]] = []
        for index, sample in enumerate(attack_result["samples"], start=1):
            add_event(
                "round.started",
                "running",
                {
                    "round": index,
                    "defenderSource": "acp-pending"
                    if acp_agent_configured("defender")
                    else "local-rule",
                },
            )
            await asyncio.sleep(0.8)
            defense, defender_source, defense_call_id = await tracked_agent_call(
                battle_id=battle_id,
                role="defender",
                invoke=lambda correlation_id, current_sample=sample: battle_defend(
                    current_sample, correlation_id=correlation_id
                ),
                add_event=add_event,
            )
            verification = verify_round(sample, defense, mode=verification_mode)
            if isinstance(verification.get("attackSuccess"), bool):
                defense["attackSuccess"] = verification["attackSuccess"]
            if isinstance(verification.get("defenseSuccess"), bool):
                defense["defenseSuccess"] = verification["defenseSuccess"]
            defender_results.append(defense)
            verifications.append(verification)
            record["defenderOut"] = defender_results
            state.battle_store.save(record)
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
                "correlationId": defense_call_id,
            }
            for key in ("attackSuccess", "defenseSuccess"):
                if isinstance(defense.get(key), bool):
                    round_data[key] = defense[key]
            if isinstance(defense.get("safeControl"), dict):
                round_data["safeControl"] = defense["safeControl"]
            add_event("round.completed", "completed", round_data)
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
                        "attackSuccess": verification.get("attackSuccess"),
                        "evidence": verification["evidence"],
                        "correlationId": defense_call_id,
                    },
                )
        add_event(
            "defense.completed",
            "completed",
            {
                "roundCount": len(defender_results),
                "layerInterceptions": derive_layer_interceptions(
                    payload.topic, defender_results
                ),
            },
        )
        record["status"] = "completed"
        record["verdict"] = aggregate_verdict(
            verification_mode, verifications, defender_results
        )
        state.battle_store.save(record)
        await asyncio.to_thread(scoring_glue.invalidate_leaderboard_cache)
        add_event(
            "battle.completed",
            "completed",
            {
                "status": record["status"],
                "verdict": record["verdict"],
                "compromisedRounds": sum(
                    1 for item in verifications if item.get("attackSuccess") is True
                ),
                "interceptedRounds": sum(
                    1
                    for item in defender_results
                    if item.get("attackSuccess") is False
                    and item.get("defenseSuccess") is True
                ),
                "verificationMode": verification_mode,
            },
        )
        await asyncio.to_thread(scoring_glue.persist_internal_score, record)
    except Exception as exc:
        logger.exception("Battle %s failed", battle_id)
        record["status"] = "failed"
        state.battle_store.save(record)
        await asyncio.to_thread(scoring_glue.invalidate_leaderboard_cache)
        message = (
            "ACP 独立 Agent 调用失败，请检查服务端日志和 URL/证书配置"
            if isinstance(exc, ACPAgentError)
            else "战局执行失败，请检查服务端日志"
        )
        add_event("battle.failed", "failed", {"error": message})
        await asyncio.to_thread(scoring_glue.persist_internal_score, record)
