from agent_attack_lab.events import build_event


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
