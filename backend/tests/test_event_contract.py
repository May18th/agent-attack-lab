from agent_attack_lab.battle_timeline import (
    emit_attack_stages,
    emit_defense_and_arbiter_stages,
    emit_post_verdict_stages,
)
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
    assert trace[-1]["checks"][1]["name"] == "参数风险检测"
    assert trace[0]["checks"][0]["name"] == "格式标准化"


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

    emit_post_verdict_stages(
        lambda event_type, status, data: emitted.append((event_type, status, data)),
        round_number=1,
        defense={"safeControl": {"status": "passed", "evidence": []}},
        classification=classification,
        correlation_id="call-1",
    )

    safe_event = next(item for item in emitted if item[0] == "defense.safe_control")
    assert classification == "full-penetration"
    assert safe_event[1] == "unresolved"
    assert safe_event[2]["classification"] == "unresolved"


def test_arbiter_verdict_names_the_exact_blocking_check() -> None:
    emitted: list[tuple[str, str, dict]] = []
    classification = emit_defense_and_arbiter_stages(
        lambda event_type, status, data: emitted.append((event_type, status, data)),
        round_number=1,
        topic="SQL 注入",
        defense={"caught": [{"ruleId": "LAB-SQLI-001"}], "risks": [], "fixed": []},
        verification={"mode": "off"},
        arbiter_review={"verdict": "undetermined"},
        correlation_id="call-1",
    )

    verdict = next(item for item in emitted if item[0] == "arbiter.verdict")
    assert classification == "blocked"
    assert verdict[2]["blockedAt"] == "L2-2"
    assert verdict[2]["blockedCheckName"] == "参数风险检测"
    assert (
        verdict[2]["statement"]
        == "样本在“L2-2 · 参数风险检测”被有效阻断，判定 blocked。"
    )
    emitted_checks = [
        item[2]["stageId"] for item in emitted if item[0] == "defense.layer.verdict"
    ]
    assert emitted_checks[-1] == "L2-2"
    assert "L2-3" not in emitted_checks


def test_similarity_check_is_an_arbiter_event_between_a5_and_a7() -> None:
    emitted: list[tuple[str, str, dict]] = []
    emit_attack_stages(
        lambda event_type, status, data: emitted.append((event_type, status, data)),
        round_number=2,
        total_rounds=2,
        difficulty="mid",
        topic="提示注入",
        sample={"sampleId": "current", "content": "ignore previous instructions"},
        previous_sample={
            "sampleId": "previous",
            "content": "ignore prior instructions",
        },
        correlation_id="call-2",
    )

    similarity = next(
        item for item in emitted if item[0] == "arbiter.similarity.checked"
    )
    assert similarity[2]["stageId"] == "A6"
    assert similarity[2]["agentRole"] == "arbiter"
    assert similarity[2]["similarityThreshold"] == 0.85
    assert isinstance(similarity[2]["similarity"], float)
    assert similarity[2]["sourceType"] in {"same-source", "new-source"}
    assert [
        item[2]["stageId"]
        for item in emitted
        if item[0].endswith("completed") or item[0] == "arbiter.similarity.checked"
    ] == ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]
