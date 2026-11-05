from agent_attack_lab.scoring import SCORING_VERSION, score_battle


def _event(
    event_type: str, data: dict, created_at: str = "2026-10-28T00:00:00+00:00"
) -> dict:
    return {"type": event_type, "data": data, "createdAt": created_at}


def test_internal_score_awards_full_score_for_traceable_acp_battle() -> None:
    attack_id = "call-attack"
    defense_id = "call-defense"
    record = {
        "status": "completed",
        "attackerOut": {
            "samples": [
                {
                    "type": "vuln",
                    "topic": "测试主题",
                    "severity": "high",
                    "scenario": "场景",
                    "objective": "目标",
                    "content": "测试内容",
                    "testCaseId": "CASE-001",
                    "attackDepth": "深度",
                    "difficulty": "high",
                    "testVariation": "变体",
                }
            ]
        },
        "defenderOut": [
            {
                "caught": [{"reason": "发现", "evidence": "依据"}],
                "risks": [{"reason": "风险", "basis": "样本文本"}],
                "fixed": [
                    {
                        "action": "建议",
                        "verificationSteps": ["验证"],
                        "passCriteria": "通过",
                        "failCriteria": "失败",
                    }
                ],
                "verificationStatus": "样本已分析，目标未验证",
            }
        ],
    }
    events = [
        _event(
            "agent.call.started",
            {
                "agentRole": "attacker",
                "correlationId": attack_id,
                "dispatchMode": "acp",
            },
        ),
        _event(
            "agent.call.completed",
            {
                "agentRole": "attacker",
                "correlationId": attack_id,
                "dispatchMode": "acp",
                "resultSource": "acp-rule-fallback",
                "durationMs": 0,
            },
        ),
        _event("attack.sample.generated", {"correlationId": attack_id}),
        _event(
            "round.started",
            {"round": 1, "responseTimingEligible": True},
            "2026-10-28T00:00:00+00:00",
        ),
        _event(
            "attack.stage.completed",
            {"round": 1, "stageId": "A7", "correlationId": attack_id, "accepted": True},
            "2026-10-28T00:00:30+00:00",
        ),
        _event(
            "agent.call.started",
            {
                "agentRole": "defender",
                "correlationId": defense_id,
                "dispatchMode": "acp",
            },
        ),
        _event(
            "agent.call.completed",
            {
                "agentRole": "defender",
                "correlationId": defense_id,
                "dispatchMode": "acp",
                "resultSource": "acp-rule-fallback",
                "durationMs": 1600,
            },
        ),
        _event(
            "round.completed",
            {
                "round": 1,
                "correlationId": defense_id,
                "attackSuccess": False,
                "defenseSuccess": True,
            },
        ),
        _event(
            "arbiter.verdict",
            {
                "round": 1,
                "correlationId": defense_id,
                "classification": "blocked",
                "attackSuccess": False,
                "defenseSuccess": True,
                "evidence": ["block-event-1"],
            },
        ),
        _event("battle.completed", {}),
    ]

    result = score_battle(record, events)

    assert result["status"] == "scored"
    assert result["version"] == SCORING_VERSION == "v2.0"
    assert (
        sum(
            item["maxScore"]
            for item in result["attacker"]["categories"]
            if item["group"] == "process"
        )
        == 40
    )
    assert (
        sum(
            item["maxScore"]
            for item in result["defender"]["categories"]
            if item["group"] == "process"
        )
        == 40
    )
    assert result["attacker"]["summary"] == {
        "processScore": 40,
        "effectScore": 0,
        "responseScore": 100,
        "baseScore": 40,
        "finalScore": 43.0,
    }
    assert result["defender"]["summary"] == {
        "processScore": 40,
        "effectScore": 45,
        "responseScore": 50,
        "baseScore": 85,
        "finalScore": 83.25,
    }
    assert result["attacker"]["score"] == 43.0
    assert result["defender"]["score"] == 83.25
    assert result["evidence"]["reportedSources"] == ["acp-rule-fallback"]
    assert result["message"]


def test_agent_scores_are_separate_and_missing_source_is_not_awarded() -> None:
    call_id = "local-call"
    record = {"status": "completed", "attackerOut": {"samples": [{}, {}]}}
    events = [
        _event(
            "agent.call.started",
            {
                "agentRole": "attacker",
                "correlationId": call_id,
                "dispatchMode": "local",
            },
        ),
        _event(
            "agent.call.completed",
            {
                "agentRole": "attacker",
                "correlationId": call_id,
                "dispatchMode": "local",
                "durationMs": 16000,
            },
        ),
        _event("attack.sample.generated", {"correlationId": call_id}),
        _event("battle.completed", {}),
    ]

    result = score_battle(record, events)
    categories = {
        item["id"]: item["score"] for item in result["attacker"]["categories"]
    }

    assert categories["A-05"] == 0
    assert categories["A-04"] == 3
    assert result["attacker"]["summary"]["responseScore"] == 0
    assert result["attacker"]["summary"]["effectScore"] == 0
    assert result["attacker"]["score"] == 6.65
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
        events.append(
            _event(
                "agent.call.started",
                {
                    "agentRole": "defender",
                    "correlationId": call_id,
                    "dispatchMode": "acp",
                },
            )
        )
        events.append(
            _event(
                "agent.call.completed",
                {
                    "agentRole": "defender",
                    "correlationId": call_id,
                    "durationMs": 1600,
                    **(
                        {"dispatchMode": "acp", "resultSource": "acp-rule-fallback"}
                        if index == 0
                        else {}
                    ),
                },
            )
        )
        events.append(_event("round.completed", {"correlationId": call_id}))

    result = score_battle(record, events)
    categories = {
        item["id"]: item["score"] for item in result["defender"]["categories"]
    }

    assert categories["D-05"] == 2


def test_v2_response_tiers_use_eligible_calls_and_safe_control_half() -> None:
    record = {
        "topic": "通用安全测试",
        "attackerOut": {"samples": [{"type": "x", "content": "x"}]},
        "defenderOut": [{"caught": [], "risks": [], "fixed": []}],
    }
    events = [
        _event("agent.call.started", {"agentRole": "attacker", "correlationId": "a"}),
        _event(
            "agent.call.completed",
            {
                "agentRole": "attacker",
                "correlationId": "a",
                "durationMs": 30000,
            },
        ),
        _event("attack.sample.generated", {"correlationId": "a"}),
        _event("agent.call.started", {"agentRole": "defender", "correlationId": "d"}),
        _event(
            "agent.call.completed",
            {
                "agentRole": "defender",
                "correlationId": "d",
                "durationMs": 4000,
            },
        ),
        _event(
            "round.completed",
            {
                "round": 1,
                "correlationId": "d",
                "classification": "blocked",
                "attackSuccess": False,
                "defenseSuccess": True,
                "safeControl": {
                    "status": "passed",
                    "evidence": ["safe-1"],
                    "durationMs": 2000,
                },
            },
        ),
        _event(
            "attack.stage.completed",
            {"round": 1, "stageId": "A7", "correlationId": "a", "accepted": True},
            "2026-10-28T00:00:30+00:00",
        ),
        _event(
            "round.started",
            {"round": 1, "responseTimingEligible": True},
            "2026-10-28T00:00:00+00:00",
        ),
    ]

    result = score_battle(record, events)

    assert result["attacker"]["summary"]["responseScore"] == 100
    assert result["defender"]["summary"]["responseScore"] == 90
    assert result["attacker"]["categories"][-1]["group"] == "response"
    assert result["defender"]["categories"][-2]["group"] == "effect"


def test_v2_effect_score_does_not_infer_success_from_round_completed_findings() -> None:
    result = score_battle(
        {"topic": "通用安全测试", "attackerOut": {"samples": [{}]}, "defenderOut": []},
        [
            _event(
                "agent.call.started", {"agentRole": "defender", "correlationId": "d"}
            ),
            _event(
                "agent.call.completed", {"agentRole": "defender", "correlationId": "d"}
            ),
            _event(
                "round.completed",
                {
                    "round": 1,
                    "correlationId": "d",
                    "caught": [{"reason": "命中"}],
                    "risks": [],
                    "fixed": [],
                },
            ),
        ],
    )

    assert result["defender"]["summary"]["effectScore"] == 0
    assert result["attacker"]["status"] == "insufficient_evidence"
    assert "summary" not in result["attacker"]


def test_v2_effect_score_requires_explicit_target_truth() -> None:
    result = score_battle(
        {
            "topic": "通用安全测试",
            "attackerOut": {"samples": [{}]},
            "defenderOut": [
                {"caught": [{"ruleId": "LAB-1"}], "risks": [], "fixed": []}
            ],
        },
        [
            _event(
                "agent.call.started", {"agentRole": "attacker", "correlationId": "a"}
            ),
            _event(
                "agent.call.completed", {"agentRole": "attacker", "correlationId": "a"}
            ),
            _event("attack.sample.generated", {"round": 1, "correlationId": "a"}),
            _event(
                "agent.call.started", {"agentRole": "defender", "correlationId": "d"}
            ),
            _event(
                "agent.call.completed", {"agentRole": "defender", "correlationId": "d"}
            ),
            _event(
                "round.completed",
                {
                    "round": 1,
                    "correlationId": "d",
                    "caught": [{"ruleId": "LAB-1"}],
                    "risks": [],
                    "fixed": [],
                },
            ),
        ],
    )

    assert result["version"] == "v2.0"
    assert result["attacker"]["summary"]["effectScore"] == 0
    assert result["defender"]["summary"]["effectScore"] == 0


def test_v2_attack_success_truth_cannot_award_defender_block_score() -> None:
    result = score_battle(
        {
            "topic": "通用安全测试",
            "attackerOut": {"samples": [{}]},
            "defenderOut": [
                {"caught": [{"ruleId": "LAB-1"}], "risks": [], "fixed": []}
            ],
        },
        [
            _event(
                "agent.call.started", {"agentRole": "attacker", "correlationId": "a"}
            ),
            _event(
                "agent.call.completed", {"agentRole": "attacker", "correlationId": "a"}
            ),
            _event("attack.sample.generated", {"round": 1, "correlationId": "a"}),
            _event(
                "agent.call.started", {"agentRole": "defender", "correlationId": "d"}
            ),
            _event(
                "agent.call.completed", {"agentRole": "defender", "correlationId": "d"}
            ),
            _event(
                "round.completed",
                {
                    "round": 1,
                    "correlationId": "d",
                    "caught": [{"ruleId": "LAB-1"}],
                    "risks": [],
                    "fixed": [],
                    "attackSuccess": True,
                    "defenseSuccess": False,
                },
            ),
        ],
    )

    assert result["attacker"]["summary"]["effectScore"] == 0
    assert result["defender"]["summary"]["effectScore"] == 0


def test_attacker_effect_score_accumulates_only_contiguous_arbiter_layers() -> None:
    record = {
        "topic": "测试主题",
        "attackerOut": {"samples": [{}]},
        "defenderOut": [{"caught": [], "risks": [], "fixed": []}],
    }
    base_events = [
        _event("agent.call.started", {"agentRole": "attacker", "correlationId": "a"}),
        _event("agent.call.completed", {"agentRole": "attacker", "correlationId": "a"}),
        _event("attack.sample.generated", {"round": 1, "correlationId": "a"}),
        _event("agent.call.started", {"agentRole": "defender", "correlationId": "d"}),
        _event("agent.call.completed", {"agentRole": "defender", "correlationId": "d"}),
    ]

    def effect_score(
        passed_layers: list[str], attack_success: bool, verdict: str
    ) -> int:
        layer_events = [
            _event(
                "arbiter.layer.confirmed",
                {
                    "round": 1,
                    "layer": layer,
                    "classification": "passed",
                    "evidenceIds": [f"e-{layer}"],
                },
            )
            for layer in passed_layers
        ]
        return next(
            category["score"]
            for category in score_battle(
                record,
                base_events
                + layer_events
                + [
                    _event(
                        "round.completed",
                        {
                            "round": 1,
                            "correlationId": "d",
                            "attackSuccess": attack_success,
                            "defenseSuccess": not attack_success,
                        },
                    ),
                    _event(
                        "arbiter.verdict",
                        {"round": 1, "classification": verdict},
                    ),
                ],
            )["attacker"]["categories"]
            if category["id"] == "A-EFFECT"
        )

    assert effect_score([], False, "blocked") == 0
    assert effect_score(["L0"], False, "blocked") == 5
    assert effect_score(["L0", "L1"], False, "blocked") == 20
    assert effect_score(["L0", "L1", "L2"], True, "contained") == 45
    assert effect_score(["L0", "L1", "L2", "L3"], True, "full-penetration") == 60


def test_match_aggregate_averages_round_snapshots_and_excludes_system_void() -> None:
    record = {"rounds": 3, "attackerOut": {"samples": [{}, {}, {}]}}
    events = []
    for number, attacker_score, defender_score, classification in (
        (1, 80, 60, "blocked"),
        (2, 100, 90, "blocked"),
        (3, None, None, "system-void"),
    ):
        if classification == "system-void":
            events.append(
                _event(
                    "round.settled",
                    {"round": number, "classification": "system-void"},
                )
            )
            continue
        events.append(
            _event(
                "arbiter.round.score",
                {
                    "round": number,
                    "classification": "scored",
                    "roundValidity": "valid",
                    "attacker": {
                        "status": "scored",
                        "score": attacker_score,
                        "summary": {
                            "baseScore": attacker_score,
                            "responseScore": 100,
                            "finalScore": attacker_score,
                        },
                    },
                    "defender": {
                        "status": "scored",
                        "score": defender_score,
                        "summary": {
                            "baseScore": defender_score,
                            "responseScore": 100,
                            "finalScore": defender_score,
                        },
                    },
                },
            )
        )

    aggregate = score_battle(record, events)["roundAggregate"]

    assert aggregate["requestedRounds"] == 3
    assert aggregate["validRounds"] == 2
    assert aggregate["systemVoidRounds"] == 1
    assert aggregate["unresolvedRounds"] == 0
    assert aggregate["coverageRatio"] == 0.6667
    assert aggregate["attacker"]["averageFinalScore"] == 90
    assert aggregate["defender"]["averageFinalScore"] == 75
    assert aggregate["status"] == "incomplete"


def test_v2_d07_requires_independent_safe_control_evidence() -> None:
    base_record = {
        "topic": "通用安全测试",
        "attackerOut": {"samples": [{}]},
        "defenderOut": [{"caught": [], "risks": [], "fixed": []}],
    }
    calls = [
        _event("agent.call.started", {"agentRole": "defender", "correlationId": "d"}),
        _event("agent.call.completed", {"agentRole": "defender", "correlationId": "d"}),
    ]

    missing = score_battle(
        base_record,
        calls
        + [
            _event(
                "round.completed",
                {
                    "round": 1,
                    "correlationId": "d",
                    "attackSuccess": False,
                    "defenseSuccess": True,
                },
            )
        ],
    )
    safe_pass = score_battle(
        base_record,
        calls
        + [
            _event(
                "round.completed",
                {
                    "round": 1,
                    "correlationId": "d",
                    "attackSuccess": False,
                    "defenseSuccess": True,
                    "safeControl": {
                        "status": "passed",
                        "evidence": ["safe-control-event-1"],
                    },
                },
            )
        ],
    )
    false_positive = score_battle(
        base_record,
        calls
        + [
            _event(
                "round.completed",
                {
                    "round": 1,
                    "correlationId": "d",
                    "attackSuccess": False,
                    "defenseSuccess": True,
                    "safeControl": {
                        "status": "blocked",
                        "evidence": ["safe-control-event-2"],
                    },
                },
            )
        ],
    )

    def d07(result):
        return next(
            item["score"]
            for item in result["defender"]["categories"]
            if item["id"] == "D-07"
        )

    assert d07(missing) == 0
    assert d07(safe_pass) == 15
    assert d07(false_positive) == 0


def test_low_difficulty_is_scaled_down() -> None:
    record = {"id": "battle-low", "topic": "general", "difficulty": "low", "rounds": 1}
    events = [
        _event(
            "agent.call.started",
            {"agentRole": "attacker", "correlationId": "a1", "dispatchMode": "acp"},
        ),
        _event(
            "agent.call.completed",
            {
                "agentRole": "attacker",
                "correlationId": "a1",
                "dispatchMode": "acp",
                "resultSource": "acp-llm",
                "durationMs": 1000,
            },
        ),
        _event("attack.sample.generated", {"correlationId": "a1"}),
        _event(
            "agent.call.started",
            {"agentRole": "defender", "correlationId": "d1", "dispatchMode": "acp"},
        ),
        _event(
            "agent.call.completed",
            {
                "agentRole": "defender",
                "correlationId": "d1",
                "dispatchMode": "acp",
                "resultSource": "acp-llm",
                "durationMs": 1600,
            },
        ),
        _event(
            "round.completed",
            {
                "round": 1,
                "correlationId": "d1",
                "attackSuccess": False,
                "defenseSuccess": True,
            },
        ),
        _event("battle.completed", {}),
    ]

    low = score_battle(record, events)
    high = score_battle({**record, "difficulty": "high"}, events)

    assert low["evidence"]["difficultyFactor"] == 0.88
    assert high["evidence"]["difficultyFactor"] == 1.0
    assert low["attacker"]["score"] < high["attacker"]["score"]
    assert low["defender"]["score"] < high["defender"]["score"]
