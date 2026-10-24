from __future__ import annotations

from fastapi.testclient import TestClient

from agent_attack_lab import config, service, state


def test_background_battle_idempotency_reuses_existing_battle(monkeypatch) -> None:
    created = []

    def fake_schedule(*args):
        created.append(args)

    monkeypatch.setattr(service, "_schedule_battle_task", fake_schedule)
    client = TestClient(service.app)

    first = client.post(
        "/battles?background=true",
        headers={"Idempotency-Key": "same-battle-key"},
        json={"topic": "same", "difficulty": "low"},
    )
    second = client.post(
        "/battles?background=true",
        headers={"Idempotency-Key": "same-battle-key"},
        json={"topic": "same", "difficulty": "low"},
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    assert len(created) == 1


def test_background_battle_idempotency_conflict_returns_409(monkeypatch) -> None:
    monkeypatch.setattr(service, "_schedule_battle_task", lambda *args: None)
    client = TestClient(service.app)

    first = client.post(
        "/battles?background=true",
        headers={"Idempotency-Key": "conflict-key"},
        json={"topic": "first", "difficulty": "low"},
    )
    second = client.post(
        "/battles?background=true",
        headers={"Idempotency-Key": "conflict-key"},
        json={"topic": "second", "difficulty": "low"},
    )

    assert first.status_code == 201
    assert second.status_code == 409


def test_cancel_running_battle_is_explicit_and_idempotent() -> None:
    client = TestClient(service.app)
    state.battle_store.save(
        {
            "id": "battle-cancel-contract",
            "difficulty": "low",
            "topic": "cancel",
            "status": "running",
            "createdAt": "2026-10-18T00:00:00+00:00",
            "attackerOut": {"samples": []},
            "defenderOut": [],
        }
    )

    response = client.post("/battles/battle-cancel-contract/cancel")

    assert response.status_code == 202
    assert response.json()["status"] == "failed"
    cancelled_score = state.battle_store.get_score("battle-cancel-contract")
    assert cancelled_score is not None
    assert cancelled_score["version"]
    assert client.post("/battles/battle-cancel-contract/cancel").status_code == 409
    audit = client.get("/battles/battle-cancel-contract/audit")
    assert audit.status_code == 200
    assert any(
        item["eventType"] == "battle.cancel.requested"
        for item in audit.json()["auditEvents"]
    )
    metrics = client.get("/metrics")
    assert metrics.status_code == 200
    assert "auditEvents" in metrics.json()


def test_battle_timeout_is_persisted_as_failed(monkeypatch) -> None:
    async def stuck_battle(_battle_id, _payload):
        await service.asyncio.sleep(10)

    state.battle_store.save(
        {
            "id": "battle-timeout-contract",
            "difficulty": "low",
            "topic": "timeout",
            "status": "pending",
            "createdAt": "2026-10-18T00:00:00+00:00",
            "attackerOut": {"samples": []},
            "defenderOut": [],
        }
    )
    monkeypatch.setattr(service, "_run_battle_async", stuck_battle)
    monkeypatch.setattr(config, "battle_timeout_seconds", 0.01)

    import asyncio

    asyncio.run(
        service._run_battle_with_tracking(
            "battle-timeout-contract",
            service.BattleRequest(difficulty="low", topic="timeout"),
        )
    )

    assert state.battle_store.get("battle-timeout-contract")["status"] == "failed"
    assert (
        state.battle_store.list_events("battle-timeout-contract")[-1]["type"]
        == "battle.timeout"
    )
    timeout_score = state.battle_store.get_score("battle-timeout-contract")
    assert timeout_score is not None
    assert timeout_score["version"]
