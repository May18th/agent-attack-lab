from agent_attack_lab import battle_timeline
from agent_attack_lab.battle_timeline import (
    emit_attack_stages,
    emit_defense_and_arbiter_stages,
    emit_post_verdict_stages,
    submission_id_for,
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
    assert classification == "unresolved"
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
    submissions = [
        item[2]["submissionId"]
        for item in emitted
        if item[0] == "attack.stage.completed" and item[2]["stageId"] == "A7"
    ]
    assert submissions == [
        submission_id_for(
            {"sampleId": "current", "content": "ignore previous instructions"}, 2
        )
    ]


def test_submission_id_is_stable_for_duplicate_payload_and_round() -> None:
    sample = {"sampleId": "sample-1", "content": "same payload"}
    assert submission_id_for(sample, 2) == submission_id_for(sample, 2)
    assert submission_id_for(sample, 2) != submission_id_for(sample, 3)
    assert submission_id_for(sample, 2) != submission_id_for(
        {"sampleId": "sample-1", "content": "different payload"}, 2
    )


def test_similarity_uses_historical_max_for_a_b_a_reuse() -> None:
    emitted: list[tuple[str, str, dict]] = []
    emit_attack_stages(
        lambda event_type, status, data: emitted.append((event_type, status, data)),
        round_number=3,
        total_rounds=3,
        difficulty="mid",
        topic="提示注入",
        sample={"sampleId": "sample-c", "content": "alpha beta gamma"},
        previous_sample={"sampleId": "sample-b", "content": "different payload"},
        historical_samples=[
            {"sampleId": "sample-a", "content": "alpha beta gamma"},
            {"sampleId": "sample-b", "content": "different payload"},
        ],
        correlation_id="call-3",
    )

    similarity = next(
        item for item in emitted if item[0] == "arbiter.similarity.checked"
    )
    assert similarity[2]["sourceType"] == "same-source"
    assert similarity[2]["maxHistoricalSimilarity"] == 1.0
    assert similarity[2]["nearestSampleId"] == "sample-a"
    assert similarity[2]["similarityToPrevious"] < 0.85
    assert similarity[2]["comparedSampleIds"] == ["sample-a", "sample-b"]
    assert similarity[2]["similarityModelVersion"] == "1"


def test_similarity_threshold_is_inclusive_and_missing_content_is_unresolved(
    monkeypatch,
) -> None:
    emitted: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(battle_timeline, "_payload_similarity", lambda *_: 0.85)
    emit_attack_stages(
        lambda event_type, status, data: emitted.append((event_type, status, data)),
        round_number=2,
        total_rounds=2,
        difficulty="mid",
        topic="提示注入",
        sample={"sampleId": "current", "content": "payload"},
        historical_samples=[{"sampleId": "prior", "content": "prior"}],
        correlation_id="call-2",
    )
    similarity = next(
        item for item in emitted if item[0] == "arbiter.similarity.checked"
    )
    assert similarity[1] == "completed"
    assert similarity[2]["sourceType"] == "same-source"
    assert similarity[2]["similarity"] == 0.85

    emitted.clear()
    monkeypatch.undo()
    emit_attack_stages(
        lambda event_type, status, data: emitted.append((event_type, status, data)),
        round_number=2,
        total_rounds=2,
        difficulty="mid",
        topic="提示注入",
        sample={"sampleId": "current", "content": ""},
        historical_samples=[{"sampleId": "prior", "content": "prior"}],
        correlation_id="call-2",
    )
    similarity = next(
        item for item in emitted if item[0] == "arbiter.similarity.checked"
    )
    assert similarity[1] == "unresolved"
    assert similarity[2]["sourceType"] == "unresolved"
    assert similarity[2]["similarity"] is None


def test_layer_pass_and_full_penetration_require_arbiter_evidence() -> None:
    emitted: list[tuple[str, str, dict]] = []
    classification = emit_defense_and_arbiter_stages(
        lambda event_type, status, data: emitted.append((event_type, status, data)),
        round_number=1,
        topic="通用安全测试",
        defense={"caught": [], "risks": [], "fixed": []},
        verification={"mode": "isolated", "attackSuccess": True},
        arbiter_review={
            "verdict": "attacker_won",
            "layerEvidence": {
                "L0": ["ev-l0"],
                "L1": ["ev-l1"],
                "L2": ["ev-l2"],
                "L3": ["ev-l3"],
            },
        },
        correlation_id="call-1",
    )

    confirmed = [item[2] for item in emitted if item[0] == "arbiter.layer.confirmed"]
    assert classification == "full-penetration"
    assert {item["layer"]: item["evidenceIds"] for item in confirmed} == {
        "L0": ["ev-l0"],
        "L1": ["ev-l1"],
        "L2": ["ev-l2"],
        "L3": ["ev-l3"],
    }
