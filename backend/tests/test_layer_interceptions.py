from fastapi.testclient import TestClient

from agent_attack_lab import service
from agent_attack_lab.layer_interceptions import derive_layer_interceptions

client = TestClient(service.app)


def test_layer_interceptions_conserves_rounds_and_routes_findings_to_one_layer() -> (
    None
):
    result = derive_layer_interceptions(
        "提示注入",
        [
            {"caught": [{"ruleId": "LAB-PROMPT-001"}], "risks": []},
            {"caught": [], "risks": []},
            {"caught": [], "risks": [{"reason": "待验证"}]},
        ],
    )

    assert result["basis"] == "derived_from_defense_results"
    assert result["total"] == 3
    assert len(result["layers"]) == 4
    layers = result["layers"]
    assert layers[0]["reached"] == 3
    assert all(
        layer["blocked"] + layer["passed"] == layer["reached"] for layer in layers
    )
    assert [layer["reached"] for layer in layers] == [3, 2, 2, 2]
    assert [layer["blocked"] for layer in layers] == [1, 0, 0, 0]
    assert [layer["passed"] for layer in layers] == [2, 2, 2, 2]
    assert sum(layer["blocked"] for layer in layers) == 1


def test_layer_interceptions_passes_all_layers_when_defense_has_no_findings() -> None:
    result = derive_layer_interceptions("SQL 注入", [{"caught": [], "risks": []}] * 2)

    assert [layer["blocked"] for layer in result["layers"]] == [0, 0, 0, 0]
    assert [layer["reached"] for layer in result["layers"]] == [2, 2, 2, 2]
    assert [layer["passed"] for layer in result["layers"]] == [2, 2, 2, 2]


def test_generic_topic_distributes_unclassified_findings_across_four_layers() -> None:
    result = derive_layer_interceptions(
        "通用安全测试",
        [
            {"caught": [{"ruleId": f"GENERIC-{index}"}], "risks": []}
            for index in range(8)
        ],
    )

    layers = result["layers"]
    assert [layer["blocked"] for layer in layers] == [2, 2, 2, 2]
    assert [layer["reached"] for layer in layers] == [8, 6, 4, 2]
    assert [layer["passed"] for layer in layers] == [6, 4, 2, 0]
    assert all(
        layer["blocked"] + layer["passed"] == layer["reached"] for layer in layers
    )


def test_specific_finding_keyword_overrides_round_robin_fallback() -> None:
    result = derive_layer_interceptions(
        "通用安全测试",
        [{"caught": [{"ruleId": "LAB-SQLI-001"}], "risks": []}],
    )

    assert [layer["blocked"] for layer in result["layers"]] == [0, 0, 1, 0]


def test_empty_defense_results_return_zero_layer_counts() -> None:
    result = derive_layer_interceptions("未知主题", [])

    assert result["basis"] == "derived_from_defense_results"
    assert result["total"] == 0
    assert len(result["layers"]) == 4
    assert all(
        layer["total"] == 0
        and layer["reached"] == 0
        and layer["blocked"] == 0
        and layer["passed"] == 0
        for layer in result["layers"]
    )


def test_sync_battle_defense_completed_event_contains_derived_layer_interceptions() -> (
    None
):
    response = client.post("/battles", json={"difficulty": "low", "topic": "提示注入"})
    assert response.status_code == 201
    battle_id = response.json()["id"]
    events = client.get(f"/battles/{battle_id}/events").json()
    completed = next(event for event in events if event["type"] == "defense.completed")

    stats = completed["data"]["layerInterceptions"]
    assert stats["basis"] == "derived_from_defense_results"
    assert stats["total"] == len(response.json()["defenderOut"])
    assert [layer["layer"] for layer in stats["layers"]] == [1, 2, 3, 4]
    assert all(
        set(layer) >= {"layer", "name", "total", "reached", "blocked", "passed"}
        for layer in stats["layers"]
    )
    assert all(
        layer["blocked"] + layer["passed"] == layer["reached"]
        for layer in stats["layers"]
    )


def test_background_battle_defense_completed_event_contains_derived_layer_interceptions() -> (
    None
):
    response = client.post(
        "/battles?background=true", json={"difficulty": "mid", "topic": "SQL 注入"}
    )
    assert response.status_code == 201
    battle_id = response.json()["id"]
    detail = client.get(f"/battles/{battle_id}").json()
    events = client.get(f"/battles/{battle_id}/events").json()
    completed = next(event for event in events if event["type"] == "defense.completed")

    stats = completed["data"]["layerInterceptions"]
    assert stats["basis"] == "derived_from_defense_results"
    assert stats["total"] == len(detail["defenderOut"])
    assert [layer["layer"] for layer in stats["layers"]] == [1, 2, 3, 4]
    assert all(
        set(layer) >= {"layer", "name", "total", "reached", "blocked", "passed"}
        for layer in stats["layers"]
    )
    assert all(
        layer["blocked"] + layer["passed"] == layer["reached"]
        for layer in stats["layers"]
    )
