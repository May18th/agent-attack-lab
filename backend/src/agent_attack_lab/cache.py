"""Optional Redis-backed JSON cache with a safe local fallback."""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Callable
from typing import Any, TypeVar

logger = logging.getLogger("agent_attack_lab.cache")
_T = TypeVar("_T")


class RedisJsonCache:
    """Best-effort Redis cache; cache failures never fail an API request."""

    def __init__(self) -> None:
        self.url = os.getenv("AGENT_REDIS_URL", "").strip()
        self.ttl_seconds = max(1, _env_int("AGENT_REDIS_TTL_SECONDS", 30))
        self._client: Any | None = None
        self._retry_after = 0.0
        self._warned_unavailable = False
        if self.url:
            try:
                import redis

                self._client = redis.Redis.from_url(
                    self.url,
                    decode_responses=False,
                    socket_connect_timeout=0.25,
                    socket_timeout=0.25,
                    health_check_interval=30,
                )
            except ImportError:
                logger.warning("AGENT_REDIS_URL configured but redis package is unavailable")

    @property
    def configured(self) -> bool:
        return bool(self.url)

    @property
    def available(self) -> bool:
        return self._client is not None and time.monotonic() >= self._retry_after

    def _call(self, operation: Callable[[Any], _T], default: _T) -> _T:
        if not self.available:
            return default
        try:
            return operation(self._client)
        except Exception as exc:  # noqa: BLE001 - Redis errors must never break the API.
            self._retry_after = time.monotonic() + 30
            if not self._warned_unavailable:
                logger.warning("Redis cache unavailable; falling back to database: %s", type(exc).__name__)
                self._warned_unavailable = True
            return default

    def get_json(self, key: str) -> Any | None:
        value = self._call(lambda client: client.get(key), None)
        if value is None:
            return None
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            self.delete(key)
            return None

    def set_json(self, key: str, value: Any, ttl_seconds: int | None = None) -> bool:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        ttl = max(1, ttl_seconds or self.ttl_seconds)
        return bool(self._call(lambda client: client.setex(key, ttl, encoded), False))

    def delete(self, *keys: str) -> None:
        if keys:
            self._call(lambda client: client.delete(*keys), None)

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:  # noqa: BLE001, S110 - cache shutdown is best effort.
                pass


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default
