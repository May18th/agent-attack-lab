from agent_attack_lab.battle_timeline import emit_defense_and_arbiter_stages
from agent_attack_lab.events import build_event
from agent_attack_lab.layer_interceptions import derive_round_layer_trace


def test_event_contains_frontend_replay_contract_metadata() -> None:
    event = build_event(
        "battle-contract",
        1,
        "round.completed",
        "completed",
        {
            "round": 2,
            "layerIndex": 1,
            "classification": "blocked",
            "scores": {"defender": 80},
        },
    )
    data = event["data"]
    assert data["stageId"] == "A6"
    assert data["round"] == 2
    assert data["layerIndex"] == 1
    assert data["classification"] == "blocked"
    assert data["scores"] == {"defender": 80}


def test_defense_completed_event_is_classified_as_completed() -> None:
    event = build_event("battle-contract", 1, "defense.completed", "completed", {})
    assert event["data"]["classification"] == "completed"


def test_layer_trace_stops_after_evidence_backed_block() -> None:
    trace = derive_round_layer_trace(
        "SQL 注入",
        {"caught": [{"ruleId": "LAB-SQLI-001"}], "risks": [], "fixed": []},
    )

    assert [layer["layer"] for layer in trace] == ["L0", "L1", "L2"]
    statuses = [item["status"] for item in trace[-1]["checks"]]
    assert statuses == [
        "passed",
        "blocked",
        "skipped-by-block",
        "skipped-by-block",
        "skipped-by-block",
    ]
    assert trace[-1]["checks"][1]["evidenceIds"] == ["LAB-SQLI-001"]


def test_safe_control_pass_requires_evidence() -> None:
    emitted: list[tuple[str, str, dict]] = []
    classification = emit_defense_and_arbiter_stages(
        lambda event_type, status, data: emitted.append((event_type, status, data)),
        round_number=1,
        topic="general",
        defense={
            "caught": [],
            "risks": [],
            "fixed": [],
            "safeControl": {"status": "passed", "evidence": []},
        },
        verification={"mode": "off"},
        arbiter_review={"verdict": "undetermined"},
        correlation_id="call-1",
    )

    safe_event = next(item for item in emitted if item[0] == "defense.safe_control")
    assert classification == "unresolved"
    assert safe_event[1] == "unresolved"
    assert safe_event[2]["classification"] == "unresolved"
