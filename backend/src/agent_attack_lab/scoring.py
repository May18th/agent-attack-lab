"""Separate evidence-based internal scores for attacker and defender agents."""

from __future__ import annotations

from typing import Any


SCORING_VERSION = "internal-agent-v2"
MAX_SCORE = 100


def _event_type(event: dict[str, Any]) -> Any:
    return event.get("type", event.get("event_type"))


def _event_data(event: dict[str, Any]) -> dict[str, Any]:
    value = event.get("data")
    return value if isinstance(value, dict) else {}


def _weighted_points(maximum: int, ratio: float) -> int:
    return int(maximum * ratio + 0.5)


def score_battle(record: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any]:
    """Score structure, execution and auditability, not security efficacy."""
    starts: dict[tuple[str, str], dict[str, Any]] = {}
    terminals: dict[tuple[str, str], dict[str, Any]] = {}
    for event in events:
        data = _event_data(event)
        role = data.get("agentRole")
        correlation_id = data.get("correlationId")
        if role not in {"attacker", "defender"} or not isinstance(correlation_id, str):
            continue
        key = (role, correlation_id)
        if _event_type(event) == "agent.call.started":
            starts[key] = data
        elif _event_type(event) in {"agent.call.completed", "agent.call.failed"}:
            terminals[key] = {**data, "eventType": _event_type(event)}

    attack_samples = record.get("attackerOut", {}).get("samples", [])
    defenses = record.get("defenderOut", [])
    sample_events = [event for event in events if _event_type(event) == "attack.sample.generated"]
    round_events = [event for event in events if _event_type(event) == "round.completed"]
    scored_roles = {
        role for role in ("attacker", "defender")
        if any(key[0] == role for key in starts) or any(key[0] == role for key in terminals)
    }

    def linked_terminal(event: dict[str, Any], role: str) -> dict[str, Any] | None:
        correlation_id = _event_data(event).get("correlationId")
        if not isinstance(correlation_id, str):
            return None
        key = (role, correlation_id)
        return terminals.get(key) if key in starts else None

    def source_ratio(role: str) -> float:
        successful_calls = [
            value for key, value in terminals.items()
            if key[0] == role
            and key in starts
            and value.get("eventType") == "agent.call.completed"
        ]
        if not successful_calls:
            return 0.0
        calls_with_source = sum(
            isinstance(call.get("dispatchMode"), str)
            and bool(call["dispatchMode"].strip())
            and isinstance(call.get("resultSource"), str)
            and bool(call["resultSource"].strip())
            for call in successful_calls
        )
        return calls_with_source / len(successful_calls)

    # Attacker evaluates test artifact completeness and whether its provenance
    # and output can be joined back to the call that produced it.
    attack_count = len(attack_samples)
    required_sample_fields = ("type", "topic", "severity", "scenario", "objective", "content")
    sample_field_ratio = (
        sum(
            sum(bool(sample.get(field)) for field in required_sample_fields)
            / len(required_sample_fields)
            for sample in attack_samples if isinstance(sample, dict)
        ) / attack_count
        if attack_count else 0.0
    )
    plan_fields = ("testCaseId", "attackDepth", "difficulty", "testVariation")
    plan_ratio = (
        sum(
            sum(bool(sample.get(field)) for field in plan_fields) / len(plan_fields)
            for sample in attack_samples if isinstance(sample, dict)
        ) / attack_count
        if attack_count else 0.0
    )
    linked_attack = [linked_terminal(event, "attacker") for event in sample_events]
    successful_attack_outputs = sum(
        terminal is not None and terminal.get("eventType") == "agent.call.completed"
        for terminal in linked_attack
    )
    attack_completion_ratio = min(successful_attack_outputs / max(attack_count, 1), 1.0)
    attack_trace_ratio = (
        sum(terminal is not None for terminal in linked_attack) / max(attack_count, len(sample_events))
        if attack_count or sample_events else 0.0
    )
    attack_source_points = _weighted_points(10, source_ratio("attacker"))
    attacker_categories = [
        {"id": "sample_structure", "label": "样本结构完整度", "score": _weighted_points(35, sample_field_ratio), "maxScore": 35,
         "basis": "按每个样本是否包含类型、主题、严重度、场景、目标和测试内容计分。"},
        {"id": "test_design", "label": "测试设计可复现性", "score": _weighted_points(20, plan_ratio), "maxScore": 20,
         "basis": "按用例编号、攻击深度、难度和测试变体字段完整度计分。"},
        {"id": "execution", "label": "调用执行完成度", "score": _weighted_points(20, attack_completion_ratio), "maxScore": 20,
         "basis": "成功调用并与生成样本关联的比例。"},
        {"id": "traceability", "label": "样本调用可追溯性", "score": _weighted_points(15, attack_trace_ratio), "maxScore": 15,
         "basis": "样本事件通过 correlationId 关联到攻击方 Agent 调用的比例。"},
        {"id": "source_disclosure", "label": "调用来源留痕", "score": attack_source_points, "maxScore": 10,
         "basis": "按成功调用中同时记录 dispatchMode 与 resultSource 的比例计分。"},
    ]

    # Defender is scored per generated round. Empty finding lists are valid;
    # points are for complete, evidence-backed analysis rather than hit volume.
    round_count = max(attack_count, len(round_events))
    response_count = min(len(defenses), round_count) if round_count else 0
    response_ratio = response_count / round_count if round_count else 0.0
    required_lists = ("caught", "risks", "fixed")
    contract_complete = sum(
        all(isinstance(defense.get(field), list) for field in required_lists)
        for defense in defenses[:round_count]
        if isinstance(defense, dict)
    )
    contract_ratio = contract_complete / round_count if round_count else 0.0

    analysis_complete = 0
    remediation_complete = 0
    for index, defense in enumerate(defenses[:round_count]):
        if not isinstance(defense, dict):
            continue
        has_findings = bool(defense.get("caught") or defense.get("risks"))
        has_analysis_basis = bool(defense.get("verificationStatus") or defense.get("analysisMode"))
        if has_findings:
            caught = defense.get("caught", [])
            risks = defense.get("risks", [])
            findings_evidenced = bool(caught or risks) and all(
                isinstance(item, dict)
                and bool(item.get("reason"))
                and bool(item.get("evidence") or item.get("basis"))
                for item in [*caught, *risks]
            )
            analysis_complete += bool(has_analysis_basis and findings_evidenced)
        else:
            analysis_complete += bool(has_analysis_basis)

        fixed = defense.get("fixed", [])
        if not fixed and not defense.get("caught") and not defense.get("risks"):
            remediation_complete += 1
        elif fixed and all(
            isinstance(item, dict)
            and bool(item.get("action"))
            and bool(item.get("verificationSteps"))
            and bool(item.get("passCriteria"))
            and bool(item.get("failCriteria"))
            for item in fixed
        ):
            remediation_complete += 1
    analysis_ratio = analysis_complete / round_count if round_count else 0.0
    remediation_ratio = remediation_complete / round_count if round_count else 0.0

    linked_rounds = [linked_terminal(event, "defender") for event in round_events]
    successful_rounds = sum(
        terminal is not None and terminal.get("eventType") == "agent.call.completed"
        for terminal in linked_rounds
    )
    defense_completion_ratio = min(successful_rounds / max(round_count, 1), 1.0)
    defense_trace_ratio = (
        sum(terminal is not None for terminal in linked_rounds) / max(round_count, len(round_events))
        if round_count or round_events else 0.0
    )
    defense_source_points = _weighted_points(5, source_ratio("defender"))
    defense_categories = [
        {"id": "response_contract", "label": "逐轮响应完整度", "score": _weighted_points(25, min(response_ratio, contract_ratio)), "maxScore": 25,
         "basis": "每个样本均有防守响应，且 caught/risks/fixed 均为对象数组。"},
        {"id": "analysis_evidence", "label": "分析依据完整度", "score": _weighted_points(20, analysis_ratio), "maxScore": 20,
         "basis": "有发现时要求理由、证据/依据和分析状态；无发现时要求明确记录分析状态。"},
        {"id": "remediation", "label": "修复建议可验证性", "score": _weighted_points(20, remediation_ratio), "maxScore": 20,
         "basis": "有修复建议时要求 action、验证步骤、通过标准和失败标准；无发现时不因没有修复建议扣分。"},
        {"id": "execution", "label": "防守调用完成度", "score": _weighted_points(20, defense_completion_ratio), "maxScore": 20,
         "basis": "成功完成并与防守回合关联的调用数 / 样本轮数。"},
        {"id": "traceability", "label": "回合调用可追溯性", "score": _weighted_points(10, defense_trace_ratio), "maxScore": 10,
         "basis": "防守回合事件通过 correlationId 关联到防守 Agent 调用的比例。"},
        {"id": "source_disclosure", "label": "调用来源留痕", "score": defense_source_points, "maxScore": 5,
         "basis": "按成功调用中同时记录 dispatchMode 与 resultSource 的比例计分。"},
    ]

    return {
        "version": SCORING_VERSION,
        "status": "scored" if scored_roles else "insufficient_evidence",
        "message": "分别衡量攻击/防守输出完整度与可审计性；不代表漏洞检出准确率、攻击成功率或真实目标修复效果。",
        "attacker": _role_score("attacker", attacker_categories, "攻击评分仅评价测试样本结构、测试设计、调用完成和追溯留痕。", "attacker" in scored_roles),
        "defender": _role_score("defender", defense_categories, "防守评分仅评价逐轮分析结构、证据与建议完整性、调用完成和追溯留痕。", "defender" in scored_roles),
        "evidence": {
            "sampleCount": attack_count,
            "completedDefenseRounds": successful_rounds,
            "startedAgentCalls": len(starts),
            "completedAgentCalls": sum(value.get("eventType") == "agent.call.completed" for value in terminals.values()),
            "failedAgentCalls": sum(value.get("eventType") == "agent.call.failed" for value in terminals.values()),
            "reportedSources": sorted({
                str(value.get("resultSource")) for value in terminals.values() if value.get("resultSource")
            }),
        },
    }


def _role_score(
    role: str,
    categories: list[dict[str, Any]],
    message: str,
    has_call_evidence: bool,
) -> dict[str, Any]:
    if not has_call_evidence:
        return {
            "status": "insufficient_evidence",
            "score": None,
            "maxScore": MAX_SCORE,
            "message": f"缺少{('攻击方' if role == 'attacker' else '防守方')} Agent 调用事件，无法评分。",
            "categories": [],
        }
    return {
        "status": "scored",
        "score": sum(item["score"] for item in categories),
        "maxScore": MAX_SCORE,
        "message": message,
        "categories": categories,
    }
