from agent_attack_lab.target_verify import aggregate_verdict, verify_round


def test_off_mode_never_creates_a_compromise() -> None:
    result = verify_round(
        {"testCaseId": "case-1"}, {"caught": [{"ruleId": "LAB-SQLI-001"}]}, mode="off"
    )
    assert result["verified"] is False
    assert result["mode"] == "off"
    assert result["simulated"] is False
    assert (
        aggregate_verdict("off", [result], [{"caught": [{"ruleId": "LAB-SQLI-001"}]}])
        == "undetermined"
    )


def test_simulated_detection_does_not_prove_target_success() -> None:
    sample = {"testCaseId": "SQLI-001", "content": "synthetic payload"}
    defense = {
        "caught": [{"ruleId": "LAB-SQLI-001", "reason": "SQL injection signature"}]
    }
    verified = verify_round(sample, defense, mode="simulated")
    assert verified["verified"] is False
    assert verified["simulated"] is True
    assert verified["reason"] == "no_simulated_target_adapter"
    assert verified["evidence"] == []
    assert aggregate_verdict("simulated", [verified], [defense]) == "undetermined"
    assert verify_round(sample, {"caught": []}, mode="simulated")["verified"] is False
    assert aggregate_verdict("simulated", [], [defense]) == "undetermined"


def test_aggregate_verdict_requires_explicit_defense_success() -> None:
    verification = {"verified": False, "mode": "simulated", "evidence": []}
    assert (
        aggregate_verdict("simulated", [verification], [{"caught": [{}]}])
        == "undetermined"
    )
    assert (
        aggregate_verdict(
            "simulated",
            [verification],
            [{"attackSuccess": False, "defenseSuccess": True}],
        )
        == "defender_won"
    )


def test_target_adapter_truth_requires_success_evidence() -> None:
    sample = {"testCaseId": "case-1", "content": "synthetic payload"}
    no_evidence = verify_round(
        sample,
        {},
        mode="simulated",
        config={"attackSuccess": True, "evidence": []},
    )
    verified = verify_round(
        sample,
        {},
        mode="simulated",
        config={"attackSuccess": True, "evidence": ["effect-event-1"]},
    )

    assert no_evidence["verified"] is False
    assert no_evidence["reason"] == "missing_target_success_evidence"
    assert verified["verified"] is True
    assert verified["attackSuccess"] is True
    assert aggregate_verdict("simulated", [verified], [{}]) == "attacker_won"


def test_live_mode_without_adapter_evidence_cannot_claim_compromise() -> None:
    result = verify_round(
        {"testCaseId": "case-1"}, {"caught": [{"ruleId": "LAB-SQLI-001"}]}, mode="live"
    )
    assert result["verified"] is False
    assert result["simulated"] is False
    assert result["reason"] == "no_live_adapter"
