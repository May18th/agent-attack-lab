from agent_attack_lab.scoring import SCORING_VERSION, score_battle


def _event(event_type: str, data: dict) -> dict:
    return {"type": event_type, "data": data}


def test_internal_score_awards_full_score_for_traceable_acp_battle() -> None:
    attack_id = "call-attack"
    defense_id = "call-defense"
    record = {
        "status": "completed",
        "attackerOut": {"samples": [{
            "type": "vuln", "topic": "测试主题", "severity": "high", "scenario": "场景",
            "objective": "目标", "content": "测试内容", "testCaseId": "CASE-001",
            "attackDepth": "深度", "difficulty": "high", "testVariation": "变体",
        }]},
        "defenderOut": [{
            "caught": [{"reason": "发现", "evidence": "依据"}],
            "risks": [{"reason": "风险", "basis": "样本文本"}],
            "fixed": [{
                "action": "建议", "verificationSteps": ["验证"],
                "passCriteria": "通过", "failCriteria": "失败",
            }],
            "verificationStatus": "样本已分析，目标未验证",
        }],
    }
    events = [
        _event("agent.call.started", {
            "agentRole": "attacker", "correlationId": attack_id, "dispatchMode": "acp",
        }),
        _event("agent.call.completed", {
            "agentRole": "attacker", "correlationId": attack_id,
            "dispatchMode": "acp", "resultSource": "acp-rule-fallback",
        }),
        _event("attack.sample.generated", {"correlationId": attack_id}),
        _event("agent.call.started", {
            "agentRole": "defender", "correlationId": defense_id, "dispatchMode": "acp",
        }),
        _event("agent.call.completed", {
            "agentRole": "defender", "correlationId": defense_id,
            "dispatchMode": "acp", "resultSource": "acp-rule-fallback",
        }),
        _event("round.completed", {"correlationId": defense_id}),
        _event("battle.completed", {}),
    ]

    result = score_battle(record, events)

    assert result["status"] == "scored"
    assert result["version"] == SCORING_VERSION == "internal-agent-v2"
    assert result["attacker"]["score"] == 100
    assert result["defender"]["score"] == 100
    assert result["evidence"]["reportedSources"] == ["acp-rule-fallback"]
    assert result["message"]


def test_agent_scores_are_separate_and_missing_source_is_not_awarded() -> None:
    call_id = "local-call"
    record = {"status": "completed", "attackerOut": {"samples": [{}, {}]}}
    events = [
        _event("agent.call.started", {
            "agentRole": "attacker", "correlationId": call_id, "dispatchMode": "local",
        }),
        _event("agent.call.completed", {
            "agentRole": "attacker", "correlationId": call_id, "dispatchMode": "local",
        }),
        _event("attack.sample.generated", {"correlationId": call_id}),
        _event("battle.completed", {}),
    ]

    result = score_battle(record, events)
    categories = {item["id"]: item["score"] for item in result["attacker"]["categories"]}

    assert categories["source_disclosure"] == 0
    assert categories["traceability"] == 8
    assert result["attacker"]["score"] == 18
    assert result["defender"]["status"] == "insufficient_evidence"


def test_internal_score_marks_legacy_battle_without_call_events_unscored() -> None:
    result = score_battle(
        {"status": "completed", "attackerOut": {"samples": [{"simulation": True}]}},
        [{"type": "battle.completed", "data": {}}],
    )

    assert result["attacker"]["status"] == "insufficient_evidence"
    assert result["attacker"]["score"] is None
    assert result["defender"]["status"] == "insufficient_evidence"


def test_defender_source_disclosure_is_proportional_to_successful_calls() -> None:
    record = {
        "attackerOut": {"samples": [{}, {}]},
        "defenderOut": [{"caught": [], "risks": [], "fixed": []} for _ in range(2)],
    }
    events = []
    for index in range(2):
        call_id = f"defense-{index}"
        events.append(_event("agent.call.started", {
            "agentRole": "defender", "correlationId": call_id, "dispatchMode": "acp",
        }))
        events.append(_event("agent.call.completed", {
            "agentRole": "defender", "correlationId": call_id,
            **({"dispatchMode": "acp", "resultSource": "acp-rule-fallback"} if index == 0 else {}),
        }))
        events.append(_event("round.completed", {"correlationId": call_id}))

    result = score_battle(record, events)
    categories = {item["id"]: item["score"] for item in result["defender"]["categories"]}

    assert categories["source_disclosure"] == 3
