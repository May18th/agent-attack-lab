import pytest
from fastapi.testclient import TestClient

from agent_attack_lab import scoring_glue, state
from agent_attack_lab.cache import RedisJsonCache
from agent_attack_lab.scoring import SCORING_VERSION
from agent_attack_lab.service import app
from agent_attack_lab.storage import BattleStore


def test_list_outputs_preserves_order_limit_and_saved_json() -> None:
    store = BattleStore(":memory:")
    try:
        assert store.list_outputs() == []
        for index in range(3):
            store.save(
                {
                    "id": f"output-{index}",
                    "topic": "统计测试",
                    "difficulty": "mid",
                    "status": "completed",
                    "createdAt": f"2026-10-27T00:00:0{index}Z",
                    "attackerOut": {"samples": [{"severity": "high", "index": index}]},
                    "defenderOut": [{"caught": ["rule"], "fixed": ["fix"]}],
                }
            )
        assert store.list_outputs(limit=0) == []
        for limit in (1, 2, 100000):
            assert store.list_outputs(limit=limit) == [
                {"attackerOut": row["attackerOut"], "defenderOut": row["defenderOut"]}
                for row in store.list(limit=limit)
            ]
        assert store.list_outputs(limit=1)[0]["attackerOut"]["samples"][0]["index"] == 2
    finally:
        store.close()


class _MemoryRedis:
    """Replace network I/O while retaining the real JSON cache behavior."""

    def __init__(self) -> None:
        self.values = {}

    def get(self, key):
        return self.values.get(key)

    def setex(self, key, _ttl, value):
        self.values[key] = value
        return True

    def delete(self, *keys):
        for key in keys:
            self.values.pop(key, None)


@pytest.fixture
def score_store(monkeypatch):
    monkeypatch.setenv("AGENT_REDIS_URL", "")
    cache = RedisJsonCache()
    cache._client = _MemoryRedis()
    store = BattleStore(":memory:")
    monkeypatch.setattr(state, "battle_store", store)
    monkeypatch.setattr(state, "redis_cache", cache)
    monkeypatch.setattr(state, "leaderboard_cache", None)
    try:
        yield store
    finally:
        store.close()


def _save_battle(store, battle_id="scores", **overrides):
    record = {
        "id": battle_id,
        "topic": "评分读取测试",
        "difficulty": "mid",
        "status": "completed",
        "createdAt": "2026-10-27T00:00:00Z",
        "attackerOut": {
            "samples": [
                {"severity": "low"},
                {"severity": "medium"},
                {"severity": "high"},
                {"severity": "unknown"},
                {},
            ]
        },
        "defenderOut": [{"caught": ["r1", "r2"], "fixed": ["f"]}, {}],
        **overrides,
    }
    store.save(record)


def test_leaderboard_preserves_scores_and_cache_invalidation(score_store):
    client = TestClient(app)
    assert client.get("/leaderboard").json() == {
        "items": [
            {"agent": "attacker", "score": 0, "rounds": 0},
            {"agent": "defender", "score": 0, "rounds": 0},
        ]
    }
    _save_battle(score_store)
    scoring_glue.invalidate_leaderboard_cache()
    expected = {
        "items": [
            {"agent": "attacker", "score": 80, "rounds": 5},
            {"agent": "defender", "score": 25, "rounds": 5},
        ]
    }
    assert client.get("/leaderboard").json() == expected
    _save_battle(score_store, "second", status="failed")
    # Both caches retain the snapshot until the existing invalidation hook runs.
    assert client.get("/leaderboard").json() == expected
    state.leaderboard_cache = None
    assert client.get("/leaderboard").json() == expected
    scoring_glue.invalidate_leaderboard_cache()
    assert client.get("/leaderboard").json() == {
        "items": [
            {"agent": "attacker", "score": 160, "rounds": 10},
            {"agent": "defender", "score": 50, "rounds": 10},
        ]
    }


def test_internal_scores_returns_empty_summaries(score_store):
    response = TestClient(app).get("/internal-scores")
    assert response.status_code == 200
    assert response.json() == {
        "version": SCORING_VERSION,
        "attacker": {
            "scoredBattleCount": 0,
            "insufficientEvidenceCount": 0,
            "averageScore": None,
        },
        "defender": {
            "scoredBattleCount": 0,
            "insufficientEvidenceCount": 0,
            "averageScore": None,
        },
        "items": [],
    }


def test_internal_scores_preserves_mixed_values_missing_snapshots_and_order(
    score_store,
):
    # Preserve existing numeric filtering, including bool (a subclass of int).
    values = [(80, 10.1), (None, 20.2), (60.5, None), ("90", True), (False, "invalid")]
    for index, (attacker, defender) in enumerate(values):
        battle_id = f"mixed-{index}"
        _save_battle(score_store, battle_id, createdAt=f"2026-10-27T00:00:0{index}Z")
        score_store.save_score(
            battle_id,
            {
                "version": SCORING_VERSION,
                "status": "scored",
                "attacker": {"score": attacker},
                "defender": {"score": defender},
            },
        )
    _save_battle(score_store, "without-snapshot", createdAt="2026-10-27T00:00:05Z")

    response = TestClient(app).get("/internal-scores")
    assert response.status_code == 200
    body = response.json()
    assert body["attacker"] == {
        "scoredBattleCount": 3,
        "insufficientEvidenceCount": 3,
        "averageScore": 46.8,
    }
    assert body["defender"] == {
        "scoredBattleCount": 3,
        "insufficientEvidenceCount": 3,
        "averageScore": 10.4,
    }
    assert [item["battleId"] for item in body["items"]] == [
        "without-snapshot",
        "mixed-4",
        "mixed-3",
        "mixed-2",
        "mixed-1",
        "mixed-0",
    ]
    assert body["items"][0]["status"] == "insufficient_evidence"
    assert body["items"][0]["attacker"]["score"] is None
    assert body["items"][1]["attacker"]["score"] is False
    assert body["items"][2]["attacker"]["score"] == "90"


def test_internal_scores_aggregates_each_role_independently(score_store):
    _save_battle(score_store)
    score_store.save_score(
        "scores",
        {
            "attacker": {"score": None},
            "defender": {"score": 0},
        },
    )
    body = TestClient(app).get("/internal-scores").json()
    assert body["attacker"] == {
        "scoredBattleCount": 0,
        "insufficientEvidenceCount": 1,
        "averageScore": None,
    }
    assert body["defender"] == {
        "scoredBattleCount": 1,
        "insufficientEvidenceCount": 0,
        "averageScore": 0.0,
    }
