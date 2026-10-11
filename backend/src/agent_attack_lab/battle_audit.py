"""Read-only integrity checks for persisted battle records and event timelines."""

from __future__ import annotations

from collections import Counter
from typing import Any


def audit_battle(record: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any]:
    """Validate immutable relationships without changing the battle or its events."""
    battle_id = str(record.get("id") or "")
    issues: list[dict[str, Any]] = []

    if not battle_id:
        issues.append({"code": "missing_battle_id", "message": "战局缺少 ID"})

    sequences = [event.get("sequence") for event in events]
    expected_sequences = list(range(1, len(events) + 1))
    if sequences != expected_sequences:
        issues.append({
            "code": "non_contiguous_sequence",
            "message": "事件序号不连续或顺序错误",
            "expected": expected_sequences,
            "actual": sequences,
        })

    event_ids = [event.get("id") for event in events]
    duplicates = sorted(event_id for event_id, count in Counter(event_ids).items() if count > 1)
    if duplicates:
        issues.append({
            "code": "duplicate_event_id",
            "message": "事件 ID 重复",
            "eventIds": duplicates,
        })

    wrong_battle = [event.get("id") for event in events if event.get("battleId") != battle_id]
    if wrong_battle:
        issues.append({
            "code": "event_battle_mismatch",
            "message": "事件归属的战局 ID 不一致",
            "eventIds": wrong_battle,
        })

    missing_status = [event.get("id") for event in events if not str(event.get("status") or "").strip()]
    if missing_status:
        issues.append({
            "code": "missing_event_status",
            "message": "事件缺少状态",
            "eventIds": missing_status,
        })

    if record.get("status") == "completed":
        event_types = [event.get("type") for event in events]
        if not event_types or event_types[0] != "battle.created":
            issues.append({
                "code": "missing_battle_created",
                "message": "已完成战局的事件时间线必须以 battle.created 开始",
            })
        if not event_types or event_types[-1] != "battle.completed":
            issues.append({
                "code": "missing_battle_completed",
                "message": "已完成战局的事件时间线必须以 battle.completed 结束",
            })

    attacker_source = record.get("attackerOut", {}).get("agentSource")
    if attacker_source:
        attack_sources = {
            event.get("data", {}).get("attackerSource")
            for event in events
            if event.get("type") in {"attack.started", "attack.sample.generated", "attack.completed"}
        }
        if attacker_source not in attack_sources:
            issues.append({
                "code": "attacker_source_mismatch",
                "message": "攻击结果来源未在事件中留下对应记录",
                "recordSource": attacker_source,
                "eventSources": sorted(str(source) for source in attack_sources if source),
            })

    defender_sources = {
        result.get("agentSource")
        for result in record.get("defenderOut", [])
        if isinstance(result, dict) and result.get("agentSource")
    }
    event_defender_sources = {
        event.get("data", {}).get("defenderSource")
        for event in events
        if event.get("type") == "round.completed"
    }
    missing_defender_sources = sorted(
        str(source) for source in defender_sources - event_defender_sources if source
    )
    if missing_defender_sources:
        issues.append({
            "code": "defender_source_mismatch",
            "message": "防守结果来源未在事件中留下对应记录",
            "recordSources": sorted(str(source) for source in defender_sources),
            "eventSources": sorted(str(source) for source in event_defender_sources if source),
        })

    return {
        "battleId": battle_id,
        "valid": not issues,
        "issueCount": len(issues),
        "eventCount": len(events),
        "issues": issues,
    }
