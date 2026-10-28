"""Event construction and audit-event persistence.

`build_event` normalises every event payload the same way regardless of who
emits it: stageId / round / layerIndex / classification are filled in, the score
block is forced to a dict, and oversized payloads are replaced by a truncated
preview bounded by ``config.event_data_max_bytes``.

Import this module as a module object, not as loose functions: call sites do
``events_api.build_event(...)`` so that a later monkeypatch of
``events.build_event`` is actually seen. The ``events_api`` alias exists only
because several call sites already use ``events`` as a local variable name for a
list of records.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from agent_attack_lab import config, state

logger = logging.getLogger("agent_attack_lab")


def bounded_event_data(data: dict[str, Any]) -> dict[str, Any]:
    serialized = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(serialized.encode("utf-8")) <= config.event_data_max_bytes:
        return data
    compact = dict(data)
    sample = compact.get("sample")
    if isinstance(sample, dict):
        sample_copy = dict(sample)
        content = str(sample_copy.get("content", ""))
        sample_copy["content"] = content[:2048]
        sample_copy["contentTruncated"] = len(content) > 2048
        compact["sample"] = sample_copy
    compact["dataTruncated"] = True
    compact["originalBytes"] = len(serialized.encode("utf-8"))
    compact_serialized = json.dumps(compact, ensure_ascii=False, separators=(",", ":"))
    if len(compact_serialized.encode("utf-8")) <= config.event_data_max_bytes:
        return compact
    return {
        "dataTruncated": True,
        "originalBytes": len(serialized.encode("utf-8")),
        "preview": serialized[: max(1, config.event_data_max_bytes // 8)],
    }


def build_event(
    battle_id: str, sequence: int, event_type: str, status: str, data: dict[str, Any]
) -> dict[str, Any]:
    normalized_data = dict(data)
    normalized_data.setdefault("stageId", event_stage_id(event_type, normalized_data))
    normalized_data.setdefault("round", normalized_data.get("round"))
    normalized_data.setdefault("layerIndex", normalized_data.get("layerIndex"))
    normalized_data.setdefault(
        "classification", event_classification(event_type, normalized_data)
    )
    scores = normalized_data.get("scores")
    normalized_data["scores"] = scores if isinstance(scores, dict) else {}
    return {
        "id": f"event-{uuid.uuid4()}",
        "battleId": battle_id,
        "sequence": sequence,
        "type": event_type,
        "status": status,
        "createdAt": datetime.now(UTC).isoformat(),
        "data": bounded_event_data(normalized_data),
    }


_EVENT_STAGE_IDS = {
    "battle.created": "A1",
    "attack.started": "A1",
    "agent.call.started": "A2",
    "attack.sample.generated": "A3",
    "attack.completed": "A4",
    "round.started": "A5",
    "round.completed": "A6",
    "attack.compromised": "A7",
    "defense.completed": "A8",
    "attack.stage.started": "ATTACK",
    "attack.stage.completed": "ATTACK",
    "attack.stage.failed": "ATTACK",
    "defense.layer.started": "DEFENSE",
    "defense.check.started": "DEFENSE",
    "defense.layer.verdict": "DEFENSE",
    "defense.safe_control": "SAFE-CONTROL",
    "arbiter.layer.confirmed": "ARBITER",
    "arbiter.similarity.checked": "A6",
    "arbiter.verdict": "ARBITER",
    "round.settled": "FINAL",
    "battle.completed": "FINAL",
    "battle.failed": "FINAL",
}


def event_stage_id(event_type: str, data: dict[str, Any]) -> str:
    explicit = data.get("stageId")
    return str(explicit) if explicit else _EVENT_STAGE_IDS.get(event_type, event_type)


def event_classification(event_type: str, data: dict[str, Any]) -> str:
    explicit = data.get("classification")
    if explicit:
        return str(explicit)
    if event_type == "attack.compromised":
        return "compromised"
    if event_type == "round.completed":
        return "blocked" if data.get("caught") else "passed"
    if event_type in {"defense.layer.verdict", "defense.safe_control"}:
        return str(data.get("status") or "unresolved")
    if event_type.endswith(".failed") or data.get("error"):
        return "failed"
    if event_type.endswith(".started"):
        return "started"
    if event_type.endswith(".completed"):
        return "completed"
    return "observed"


def record_audit_event(
    event_type: str,
    *,
    status: str,
    request_id: str | None = None,
    battle_id: str | None = None,
    correlation_id: str | None = None,
    actor_role: str | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    try:
        state.battle_store.save_audit_event(
            {
                "id": f"audit-{uuid.uuid4()}",
                "eventType": event_type,
                "requestId": request_id,
                "battleId": battle_id,
                "correlationId": correlation_id,
                "actorRole": actor_role,
                "status": status,
                "createdAt": datetime.now(UTC).isoformat(),
                "data": data or {},
            }
        )
    except Exception as exc:  # noqa: BLE001  # pragma: no cover - database-specific failure path
        logger.warning(
            "Audit persistence failed event=%s error=%s", event_type, type(exc).__name__
        )
