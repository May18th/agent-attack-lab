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

from agent_attack_lab import (
    battle_timeline,
    candidate_library,
    config,
    library_store,
    scoring_glue,
    state,
)
from agent_attack_lab import events as events_api
from agent_attack_lab.acp_agents import (
    ACPAgentError,
    call_attacker,
    call_defender,
)
from agent_attack_lab.acp_agents import (
    is_configured as acp_agent_configured,
)
from agent_attack_lab.agent_logic import DefendRequest, defend
from agent_attack_lab.agents.arbiter import review_round
from agent_attack_lab.agents.attack_evolve import summarize_escalation
from agent_attack_lab.agents.knowledge import (
    build_attacker_knowledge,
    build_defender_knowledge,
)
from agent_attack_lab.layer_interceptions import derive_layer_interceptions
from agent_attack_lab.scoring import SCORING_VERSION, score_battle_rounds
from agent_attack_lab.target_verify import (
    aggregate_verdict,
    configured_verify_mode,
    verify_round_live,
)
from agent_attack_lab.targets.controlled_target import describe_result

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


def schedule_battle_task(battle_id: str, payload: BattleRequest) -> asyncio.Task[Any]:
    """Start a battle independently of the HTTP response lifecycle.

    FastAPI ``BackgroundTasks`` run after the response handler but remain tied to
    the request ASGI task. Proxies can buffer that response until the work ends,
    making the UI appear stuck before the first timeline event arrives.
    """
    task = asyncio.create_task(run_battle_with_tracking(battle_id, payload))

    # Register before yielding to the event loop so an immediate cancel request
    # can always find the task, even if the coroutine has not started yet.
    state.battle_tasks[battle_id] = task

    def clear_task(completed: asyncio.Task[Any]) -> None:
        if state.battle_tasks.get(battle_id) is completed:
            state.battle_tasks.pop(battle_id, None)

    task.add_done_callback(clear_task)
    return task


async def battle_attack(
    payload: BattleRequest,
    *,
    correlation_id: str,
    round_index: int = 1,
    total_rounds: int | None = None,
    previous_round: dict[str, Any] | None = None,
    candidate_memory: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], str]:
    agent_payload = payload.model_dump()
    agent_payload["_roundIndex"] = round_index
    agent_payload["_totalRounds"] = total_rounds or payload.rounds
    if previous_round:
        # 上一回合的实测结论要进到攻击方上下文里，否则每轮都是独立开盲盒。
        agent_payload["_previousRound"] = previous_round
    if candidate_memory:
        # 候选库记忆注入：一局记忆（第 2 回合起）+ 跨局记忆（开关开启时），
        # 智能体据此做逐回合迭代学习；只注入 attacker 自己的策略记录。
        agent_payload["_candidateMemory"] = {
            "role": "attacker",
            "records": candidate_memory,
        }
    seeded = library_store.agent_context(
        "attacker", topic=payload.topic, difficulty=payload.difficulty
    )
    # Formal six-theme catalogs supersede the legacy admin seed rows for that
    # topic.  Mixing both sources would send duplicate samples/rules to the
    # agent; legacy/custom topics continue to use the admin tables unchanged.
    source_records = seeded["records"] or state.battle_store.list_admin_samples(
        limit=200, offset=0
    )
    knowledge = build_attacker_knowledge(source_records, topic=payload.topic)
    if knowledge["records"]:
        agent_payload["_knowledgeContext"] = knowledge
    result = await call_attacker(agent_payload, correlation_id=correlation_id)
    source = "local-rule"
    if result is None:
        # 延迟导入：attacker 模块在导入时构建 AIP app，这里只需要纯本地演进逻辑。
        from agent_attack_lab.agents.attacker import evolve_local

        result = evolve_local(
            agent_payload,
            previous_round,
            round_index,
            total_rounds or payload.rounds,
        )
        result["agentMode"] = "local-rule"
    else:
        source = result.pop("agentSource", None) or (
            "acp-llm" if result.get("agentMode") == "llm" else "acp-rule-fallback"
        )
    return {**result, "agentSource": source}, source


async def battle_defend(
    sample: dict[str, Any],
    *,
    correlation_id: str,
    candidate_memory: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], str]:
    topic = str(sample.get("topic") or "")
    seeded = library_store.agent_context(
        "defender", topic=topic, difficulty=str(sample.get("difficulty") or "mid")
    )
    source_rules = seeded["records"] or state.battle_store.list_admin_rules(
        limit=200, offset=0
    )
    knowledge = build_defender_knowledge(source_rules, topic=topic)
    agent_payload: dict[str, Any] = {"sample": sample}
    if knowledge["records"]:
        agent_payload["_knowledgeContext"] = knowledge
    if candidate_memory:
        # Defender 只读自己的特征候选记录（拦截/穿透录入）。
        agent_payload["_candidateMemory"] = {
            "role": "defender",
            "records": candidate_memory,
        }
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
    round_number: int | None = None,
    stage_id: str | None = None,
) -> tuple[dict[str, Any], str, str]:
    correlation_id = f"call-{uuid.uuid4()}"
    dispatch_mode = "acp" if acp_agent_configured(role) else "local"
    event_data: dict[str, Any] = {
        "correlationId": correlation_id,
        "agentRole": role,
        "dispatchMode": dispatch_mode,
        "round": round_number,
        "stageId": stage_id or ("A2" if role == "attacker" else "DEFENSE"),
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
        record["crossMemory"] = payload.crossMemory
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
        attack_result: dict[str, Any] = {"samples": []}
        attacker_sources: list[str] = []
        defender_results: list[dict[str, Any]] = []
        previous_sample: dict[str, Any] | None = None
        previous_round: dict[str, Any] | None = None
        for index in range(1, payload.rounds + 1):
            # 记录上一回合样本（用于相似度与候选库），在覆盖前固定引用。
            prior_sample = previous_sample
            attacker_memory = candidate_library.agent_memory(
                battle_id=battle_id,
                role="attacker",
                round_index=index,
                cross_enabled=payload.crossMemory,
            )
            add_event(
                "round.started",
                "running",
                {
                    "round": index,
                    "rounds": payload.rounds,
                    "structuredTimelineVersion": "v2.0",
                    "rulesVersion": SCORING_VERSION,
                    "responseTimingEligible": True,
                    "defenderSource": "acp-pending"
                    if acp_agent_configured("defender")
                    else "local-rule",
                    "candidateMemory": {
                        "crossEnabled": payload.crossMemory,
                        "attackerRecords": len(attacker_memory),
                    },
                },
            )
            round_payload = payload.model_copy(update={"rounds": 1})
            generated, attacker_source, attack_call_id = await tracked_agent_call(
                battle_id=battle_id,
                role="attacker",
                # 回调可能被重试逻辑延后调用：用默认参数把当轮的 index/previous_round
                # 固定下来，避免读到后续轮次的值（B023）。
                invoke=lambda correlation_id, current_payload=round_payload, current_round=index, previous=previous_round, memory=attacker_memory: (
                    battle_attack(
                        current_payload,
                        correlation_id=correlation_id,
                        round_index=current_round,
                        total_rounds=payload.rounds,
                        previous_round=previous,
                        candidate_memory=memory,
                    )
                ),
                add_event=add_event,
                round_number=index,
                stage_id="A1",
            )
            generated_samples = generated.get("samples")
            if not isinstance(generated_samples, list) or len(generated_samples) != 1:
                raise ValueError("attacker must generate exactly one sample per round")
            sample = dict(generated_samples[0])
            sample["round"] = index
            original_sample_id = sample.get("testCaseId") or sample.get("sampleId")
            if original_sample_id and payload.rounds > 1:
                sample["testCaseId"] = f"{original_sample_id}-R{index:02d}"
            attack_result["samples"].append(sample)
            attacker_sources.append(attacker_source)
            attack_result["agentSource"] = (
                attacker_sources[0] if len(set(attacker_sources)) == 1 else "mixed"
            )
            record["attackerOut"] = attack_result
            state.battle_store.save(record)
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
            battle_timeline.emit_attack_stages(
                add_event,
                round_number=index,
                total_rounds=payload.rounds,
                difficulty=payload.difficulty,
                topic=payload.topic,
                sample=sample,
                previous_sample=previous_sample,
                historical_samples=attack_result["samples"][:-1],
                correlation_id=attack_call_id,
            )
            previous_sample = sample
            await asyncio.sleep(0.8)
            defender_memory = candidate_library.agent_memory(
                battle_id=battle_id,
                role="defender",
                round_index=index,
                cross_enabled=payload.crossMemory,
            )
            defense, defender_source, defense_call_id = await tracked_agent_call(
                battle_id=battle_id,
                role="defender",
                invoke=lambda correlation_id, current_sample=sample, memory=defender_memory: (
                    battle_defend(
                        current_sample,
                        correlation_id=correlation_id,
                        candidate_memory=memory,
                    )
                ),
                add_event=add_event,
                round_number=index,
                stage_id="DEFENSE",
            )
            verification = await verify_round_live(
                sample,
                defense,
                mode=verification_mode,
                difficulty=payload.difficulty,
            )
            if verification.get("mode") == "live":
                defense["verificationStatus"] = describe_result(verification)
                defense["verificationMode"] = "live"
                defense["verificationTarget"] = verification.get("targetAssetId")
                defense["targetProfile"] = verification.get("targetProfile")
                if isinstance(verification.get("baselineAttackSuccess"), bool):
                    defense["baselineAttackSuccess"] = verification[
                        "baselineAttackSuccess"
                    ]
                excerpts = [
                    item
                    for item in verification.get("evidence") or []
                    if isinstance(item, str)
                ][:2]
                if excerpts:
                    defense["verificationEvidence"] = excerpts
            if isinstance(verification.get("attackSuccess"), bool):
                defense["attackSuccess"] = verification["attackSuccess"]
            if isinstance(verification.get("defenseSuccess"), bool):
                defense["defenseSuccess"] = verification["defenseSuccess"]
            defender_results.append(defense)
            verifications.append(verification)
            arbiter_review = await review_round(sample, defense, verification)
            defense["arbiterReview"] = arbiter_review
            record["defenderOut"] = defender_results
            state.battle_store.save(record)
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
            feature_action = battle_timeline.emit_post_verdict_stages(
                add_event,
                round_number=index,
                defense=defense,
                classification=classification,
                correlation_id=defense_call_id,
            )
            # 交给下一轮攻击方：样本、防守命中、靶标结论一起传，变体才有依据。
            previous_round = {
                "round": index,
                "sample": sample,
                "defense": defense,
                "verification": verification,
                "classification": classification,
            }
            round_data = {
                "round": index,
                "sample": sample,
                "caught": defense["caught"],
                "risks": defense["risks"],
                "fixed": defense["fixed"],
                "defenderSource": defender_source,
                "analysisMode": defense.get("analysisMode"),
                "verificationStatus": defense.get("verificationStatus"),
                "verificationMode": defense.get("verificationMode"),
                "verificationTarget": defense.get("verificationTarget"),
                "verificationEvidence": defense.get("verificationEvidence"),
                "targetProfile": defense.get("targetProfile"),
                "baselineAttackSuccess": defense.get("baselineAttackSuccess"),
                "scopeNotice": defense.get("scopeNotice"),
                "correlationId": defense_call_id,
                "arbiterReview": arbiter_review,
                "classification": classification,
                "structuredTimelineVersion": "v2.0",
                "strengthTier": sample.get("strengthTier"),
                "strengthScore": sample.get("strengthScore"),
                "tactic": sample.get("tactic"),
                "variantOperator": sample.get("variantOperator"),
                "adaptationNote": sample.get("adaptationNote"),
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
            # 回合结算：从回合证据构建 Attacker 策略候选与 Defender 特征候选，
            # 写入一局库（始终）与跨局库（跨局记忆开启时），并随事件广播。
            candidate_result = await asyncio.to_thread(
                candidate_library.record_round,
                battle_id=battle_id,
                round_number=index,
                topic=payload.topic,
                sample=sample,
                defense=defense,
                verification=verification,
                classification=classification,
                previous_sample=prior_sample,
                cross_enabled=payload.crossMemory,
            )
            add_event(
                "round.settled",
                "completed",
                {
                    "round": index,
                    "stageId": "FINAL",
                    "classification": classification,
                    "structuredTimelineVersion": "v2.0",
                    "rulesVersion": SCORING_VERSION,
                    "candidateLibrary": {
                        "attacker": candidate_result["attacker"],
                        "defender": candidate_result["defender"],
                        "crossEnabled": payload.crossMemory,
                    },
                },
            )
            submission_id = battle_timeline.submission_id_for(sample, index)
            persisted_events = state.battle_store.list_events(battle_id)
            snapshot_exists = any(
                event.get("type") in {"arbiter.round.score", "arbiter.round.scored"}
                and (event.get("data") or {}).get("round") == index
                and (event.get("data") or {}).get("submissionId") == submission_id
                and (event.get("data") or {}).get("rulesVersion") == SCORING_VERSION
                for event in persisted_events
            )
            if not snapshot_exists:
                round_scores = score_battle_rounds(record, persisted_events)
                current_score = next(
                    (item for item in round_scores if item["round"] == index), None
                )
                score_complete = current_score is not None and all(
                    current_score[role].get("status") == "scored"
                    and isinstance(current_score[role].get("score"), (int, float))
                    for role in ("attacker", "defender")
                )
                round_validity = (
                    "system-void"
                    if classification == "system-void"
                    else "valid"
                    if score_complete and classification != "unresolved"
                    else "unresolved"
                )
                add_event(
                    "arbiter.round.score",
                    "completed" if score_complete else "unresolved",
                    {
                        "round": index,
                        "stageId": "ROUND-SCORE",
                        "agentRole": "arbiter",
                        "submissionId": submission_id,
                        "rulesVersion": SCORING_VERSION,
                        "roundValidity": round_validity,
                        "classification": (
                            "scored" if score_complete else "unresolved"
                        ),
                        "featureAction": feature_action["featureAction"],
                        "featureActionReason": feature_action["featureActionReason"],
                        "scores": current_score.get("scores", {})
                        if current_score
                        else {},
                        "attacker": current_score.get("attacker")
                        if current_score
                        else None,
                        "defender": current_score.get("defender")
                        if current_score
                        else None,
                        "statement": "本回合全部环节完成，评分已生成。"
                        if current_score
                        else "本回合评分证据不足。",
                    },
                )
        add_event(
            "attack.completed",
            "completed",
            {
                "sampleCount": len(attack_result["samples"]),
                "rounds": payload.rounds,
                "attackerSource": attack_result.get("agentSource"),
                "escalation": summarize_escalation(attack_result["samples"]),
            },
        )
        add_event(
            "defense.completed",
            "completed",
            {
                "roundCount": len(defender_results),
                "rounds": payload.rounds,
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
