"""Score persistence, backfill and leaderboard invalidation helpers.

Terminal battles are scored once and the snapshot is persisted in
``battle_scores``. Read APIs only ever serve that stored snapshot; when it is
missing they return an explicit ``insufficient_evidence`` payload instead of a
live estimate that could drift between calls.

Pure glue: no routing, no request handling, and no import of ``service``.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from agent_attack_lab import config, state
from agent_attack_lab.scoring import SCORING_VERSION, score_battle

logger = logging.getLogger(__name__)


def invalidate_leaderboard_cache() -> None:
    state.leaderboard_cache = None
    state.redis_cache.delete(
        "agent-attack-lab:v1:leaderboard",
        "agent-attack-lab:v1:dashboard-summary",
        "agent-attack-lab:v2:dashboard-summary",
    )


def persist_internal_score(record: dict[str, Any]) -> None:
    """Persist a terminal battle's evidence-derived score snapshot."""
    try:
        score = score_battle(record, state.battle_store.list_events(record["id"]))
        state.battle_store.save_score(record["id"], score)
    except Exception as exc:  # noqa: BLE001  # pragma: no cover - database-specific failure path
        logger.warning(
            "Battle %s score snapshot unavailable (%s)",
            record.get("id"),
            type(exc).__name__,
        )


def insufficient_internal_score() -> dict[str, Any]:
    """Return the explicit no-snapshot response used by read APIs.

    A live calculation is intentionally not exposed as an authoritative score. Terminal
    battles are scored once and persisted in ``battle_scores``; callers without that
    snapshot must see evidence insufficiency instead of a value that can change.
    """
    role_message = "缺少已持久化的 Agent 调用评分快照，无法提供真实分数。"
    return {
        "version": SCORING_VERSION,
        "status": "insufficient_evidence",
        "message": "当前战局没有可用的 battle_scores 快照；未使用前端或接口实时估算值。",
        "attacker": {
            "status": "insufficient_evidence",
            "score": None,
            "maxScore": 100,
            "message": role_message,
            "categories": [],
        },
        "defender": {
            "status": "insufficient_evidence",
            "score": None,
            "maxScore": 100,
            "message": role_message,
            "categories": [],
        },
    }


def role_scores(record: dict[str, Any]) -> tuple[int, int]:
    """Legacy per-role tallies shown by the report and leaderboard views."""
    samples = record["attackerOut"].get("samples", [])
    defenses = record.get("defenderOut", [])
    severity_points = {"low": 10, "medium": 20, "high": 30}
    attacker_score = sum(
        severity_points.get(sample.get("severity", "low"), 10) for sample in samples
    )
    defender_score = sum(
        len(item.get("caught", [])) * 10 + len(item.get("fixed", [])) * 5
        for item in defenses
    )
    return attacker_score, defender_score


def battle_stats(
    record: dict[str, Any], events: list[dict[str, Any]] | None = None
) -> dict[str, int]:
    samples = record.get("attackerOut", {}).get("samples", [])
    defenses = record.get("defenderOut", [])
    return {
        "attackGenerated": len(samples),
        "defenderDetected": sum(
            len(item.get("caught", [])) for item in defenses if isinstance(item, dict)
        ),
        "fixesSuggested": sum(
            len(item.get("fixed", [])) for item in defenses if isinstance(item, dict)
        ),
        # TODO 战略检测口径：当前以 round.completed 事件计数。
        "strategyChecks": sum(
            1 for event in (events or []) if event.get("type") == "round.completed"
        ),
    }


def backfill_missing_internal_scores(
    limit: int = config.score_backfill_batch_size,
) -> int:
    """Backfill a bounded batch of terminal battles without replacing snapshots."""
    list_records = getattr(state.battle_store, "list", None)
    list_scores = getattr(state.battle_store, "list_scores", None)
    if not callable(list_records) or not callable(list_scores) or limit <= 0:
        return 0

    records: list[dict[str, Any]] = []
    remaining = limit
    try:
        for status in ("completed", "failed"):
            if remaining <= 0:
                break
            batch = list_records(limit=remaining, offset=0, status=status)
            records.extend(batch)
            remaining -= len(batch)
        if not records:
            return 0
        stored = list_scores([record["id"] for record in records])
        missing = [record for record in records if record["id"] not in stored]
        for record in missing:
            persist_internal_score(record)
        return len(missing)
    except Exception as exc:  # noqa: BLE001  # pragma: no cover - database-specific failure path
        logger.warning("Battle score backfill unavailable (%s)", type(exc).__name__)
        return 0


async def run_score_backfill() -> None:
    await asyncio.to_thread(backfill_missing_internal_scores)
