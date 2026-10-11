from __future__ import annotations

from agent_attack_lab.battle_audit import audit_battle


def _record() -> dict[str, object]:
    return {
        "id": "battle-audit",
        "status": "completed",
        "attackerOut": {"agentSource": "local-rule", "samples": []},
        "defenderOut": [],
    }


def _event(sequence: int, event_type: str, *, battle_id: str = "battle-audit", data: dict | None = None) -> dict:
    return {
        "id": f"event-{sequence}",
        "battleId": battle_id,
        "sequence": sequence,
        "type": event_type,
        "status": "completed",
        "data": data or {},
    }


def test_audit_accepts_contiguous_completed_timeline() -> None:
    events = [
        _event(1, "battle.created"),
        _event(2, "attack.completed", data={"attackerSource": "local-rule"}),
        _event(3, "battle.completed"),
    ]

    result = audit_battle(_record(), events)

    assert result["valid"] is True
    assert result["issueCount"] == 0


def test_audit_reports_sequence_and_battle_mismatch() -> None:
    events = [
        _event(2, "battle.created"),
        _event(2, "battle.completed", battle_id="other-battle"),
    ]

    result = audit_battle(_record(), events)

    assert result["valid"] is False
    assert {issue["code"] for issue in result["issues"]} >= {
        "non_contiguous_sequence",
        "duplicate_event_id",
        "event_battle_mismatch",
    }


def test_audit_detects_missing_source_trace() -> None:
    record = _record()
    record["defenderOut"] = [{"agentSource": "acp-rule-fallback"}]
    events = [
        _event(1, "battle.created"),
        _event(2, "attack.completed", data={"attackerSource": "local-rule"}),
        _event(3, "round.completed", data={"defenderSource": "local-rule"}),
        _event(4, "battle.completed"),
    ]

    result = audit_battle(record, events)

    assert result["valid"] is False
    assert any(issue["code"] == "defender_source_mismatch" for issue in result["issues"])
