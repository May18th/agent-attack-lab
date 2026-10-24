"""Process-wide mutable state for the battle service.

Every consumer reads these as ``state.<name>`` at call time instead of doing
``from .state import battle_store``. That matters for tests: ``monkeypatch``
rebinds an attribute on this module, and only lookups that go through the
module see the rebinding. A name imported into another module keeps the old
object and the test passes for the wrong reason.

Immutable configuration (env-derived constants, CORS origins, API key) does
not belong here; it lives in ``config.py``.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict, deque
from threading import Lock
from typing import Any

from agent_attack_lab.cache import RedisJsonCache
from agent_attack_lab.storage import BattleStore

# Persistence and cache backends.
battle_store = BattleStore()
redis_cache = RedisJsonCache()

# Short-lived in-process caches.
leaderboard_cache: tuple[float, dict[str, Any]] | None = None
REPORT_SUMMARY_CACHE_TTL_SECONDS = 600.0
REPORT_SUMMARY_CACHE_MAX_ENTRIES = 256
report_summary_cache: dict[tuple[str, int, str], tuple[float, dict[str, Any]]] = {}

# Rate limiting windows, keyed by client fingerprint.
rate_windows: dict[str, deque[float]] = defaultdict(deque)
rate_lock = Lock()
public_battle_rate_windows: dict[str, deque[float]] = defaultdict(deque)
public_battle_rate_lock = Lock()

# Browser session and login throttling state, owned by security.py.
browser_sessions: dict[str, float] = {}
browser_sessions_lock = Lock()
browser_login_attempts: dict[str, deque[float]] = defaultdict(deque)
browser_login_lock = Lock()
cloudflare_jwk_client: Any | None = None
cloudflare_jwk_lock = Lock()

# Counters surfaced by /metrics.
rate_limited_count = 0
battle_timeout_count = 0
battle_cancel_count = 0

# Background task bookkeeping and de-duplication guards.
recovery_tasks: set[asyncio.Task[Any]] = set()
battle_tasks: dict[str, asyncio.Task[Any]] = {}
cancel_requested: set[str] = set()
idempotency_lock = Lock()
