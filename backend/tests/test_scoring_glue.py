from agent_attack_lab.scoring_glue import battle_stats


def test_battle_stats_defaults_to_zero_for_empty_record() -> None:
    assert battle_stats({}) == {
        "attackGenerated": 0,
        "defenderDetected": 0,
        "fixesSuggested": 0,
        "strategyChecks": 0,
    }


def test_battle_stats_counts_findings_and_only_completed_round_events() -> None:
    record = {
        "attackerOut": {"samples": [{}, {}]},
        "defenderOut": [
            {"caught": ["a", "b"], "fixed": ["fix"]},
            None,
            "invalid",
            {},
            {"caught": ["c"], "fixed": ["fix2", "fix3"]},
        ],
    }
    events = [
        {"type": "round.completed"},
        {"type": "defense.completed"},
        {},
        {"type": "round.completed"},
    ]
    assert battle_stats(record, events) == {
        "attackGenerated": 2,
        "defenderDetected": 3,
        "fixesSuggested": 3,
        "strategyChecks": 2,
    }
