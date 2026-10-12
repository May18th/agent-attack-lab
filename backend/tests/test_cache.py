from __future__ import annotations

import json

from agent_attack_lab.cache import RedisJsonCache


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def setex(self, key: str, ttl: int, value: str) -> bool:
        self.values[key] = value
        self.ttls[key] = ttl
        return True

    def delete(self, *keys: str) -> int:
        removed = 0
        for key in keys:
            removed += int(self.values.pop(key, None) is not None)
            self.ttls.pop(key, None)
        return removed


def test_json_cache_round_trip_and_ttl(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_REDIS_URL", "redis://127.0.0.1:6379/0")
    cache = RedisJsonCache()
    fake = FakeRedis()
    cache._client = fake

    assert cache.set_json("key", {"内容": [1, 2]}, ttl_seconds=17)
    assert json.loads(fake.values["key"]) == {"内容": [1, 2]}
    assert fake.ttls["key"] == 17
    assert cache.get_json("key") == {"内容": [1, 2]}
    cache.delete("key")
    assert cache.get_json("key") is None


def test_cache_failure_is_best_effort(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_REDIS_URL", "redis://127.0.0.1:6379/0")
    cache = RedisJsonCache()

    class BrokenRedis:
        def get(self, _key: str) -> None:
            raise RuntimeError("offline")

    cache._client = BrokenRedis()
    assert cache.get_json("key") is None
    assert cache.set_json("key", {"ok": True}) is False
