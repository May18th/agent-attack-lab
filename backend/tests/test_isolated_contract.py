"""Contract checks that always use a temporary battle database."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from agent_attack_lab import state
from agent_attack_lab.service import app
from agent_attack_lab.storage import BattleStore


@pytest.fixture
def isolated_client(tmp_path, monkeypatch):
    """Keep every contract check away from the developer's default database."""
    store = BattleStore(str(tmp_path / "isolated-battles.sqlite3"))
    monkeypatch.setattr(state, "battle_store", store)
    return TestClient(app), store


def test_blank_topic_returns_422(isolated_client) -> None:
    client, _ = isolated_client

    response = client.post("/battles", json={"difficulty": "low", "topic": "  \t"})

    assert response.status_code == 422


def test_valid_battle_returns_201(isolated_client) -> None:
    client, store = isolated_client

    response = client.post("/battles", json={"difficulty": "low", "topic": "隔离验收"})

    assert response.status_code == 201
    battle = response.json()
    assert battle["status"] == "completed"
    assert store.get(battle["id"]) is not None


def test_completed_battle_delete_returns_204_and_cleans_events(isolated_client) -> None:
    client, store = isolated_client
    created = client.post("/battles", json={"difficulty": "low", "topic": "删除验收"})
    battle_id = created.json()["id"]
    assert store.list_events(battle_id)

    response = client.delete(f"/battles/{battle_id}")

    assert response.status_code == 204
    assert store.get(battle_id) is None
    assert store.list_events(battle_id) == []


def test_running_battle_delete_returns_409(isolated_client) -> None:
    client, store = isolated_client
    store.save(
        {
            "id": "isolated-running-battle",
            "difficulty": "low",
            "topic": "运行中验收",
            "status": "running",
            "createdAt": "2026-10-12T00:00:00+00:00",
            "attackerOut": {"samples": []},
            "defenderOut": [],
        }
    )

    response = client.delete("/battles/isolated-running-battle")

    assert response.status_code == 409
    assert store.get("isolated-running-battle") is not None
