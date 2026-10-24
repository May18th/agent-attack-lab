from agent_attack_lab.target_verify import aggregate_verdict, verify_round


def test_off_mode_never_creates_a_compromise() -> None:
    result = verify_round({"testCaseId": "case-1"}, {"caught": [{"ruleId": "LAB-SQLI-001"}]}, mode="off")
    assert result["verified"] is False
    assert result["mode"] == "off"
    assert result["simulated"] is False
    assert aggregate_verdict("off", [result], [{"caught": [{"ruleId": "LAB-SQLI-001"}]}]) == "undetermined"


def test_simulated_verification_is_explicit_and_requires_a_known_detection() -> None:
    sample = {"testCaseId": "SQLI-001", "content": "synthetic payload"}
    defense = {"caught": [{"ruleId": "LAB-SQLI-001", "reason": "SQL injection signature"}]}
    verified = verify_round(sample, defense, mode="simulated")
    assert verified["verified"] is True
    assert verified["simulated"] is True
    assert verified["evidence"]
    assert aggregate_verdict("simulated", [verified], [defense]) == "attacker_won"
    assert verify_round(sample, {"caught": []}, mode="simulated")["verified"] is False
    assert aggregate_verdict("simulated", [], [defense]) == "defender_won"


def test_live_mode_without_adapter_evidence_cannot_claim_compromise() -> None:
    result = verify_round({"testCaseId": "case-1"}, {"caught": [{"ruleId": "LAB-SQLI-001"}]}, mode="live")
    assert result["verified"] is False
    assert result["simulated"] is False
    assert result["reason"] == "no_live_adapter"
