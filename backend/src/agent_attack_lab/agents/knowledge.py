"""Role-scoped projections for knowledge supplied to standalone LLM agents.

The admin tables are intentionally broader than an agent prompt.  This module
keeps the prompt boundary explicit: callers may provide only a projection for
the current role, and each projection drops fields belonging to the other
agent before the data reaches the model.
"""

from __future__ import annotations

from typing import Any

_MAX_RECORDS = 8
_MAX_TEXT = 500


def _text(value: Any, *, limit: int = _MAX_TEXT) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] if value else None


def _topic_matches(record: dict[str, Any], topic: str) -> bool:
    record_topic = _text(record.get("topic"), limit=200)
    if not record_topic:
        return True
    normalized_topic = topic.casefold().strip()
    normalized_record_topic = record_topic.casefold()
    if not normalized_topic:
        return False
    return (
        normalized_record_topic in normalized_topic
        or normalized_topic in normalized_record_topic
    )


def build_attacker_knowledge(
    records: list[dict[str, Any]] | None,
    *,
    topic: str,
) -> dict[str, Any]:
    """Project synthetic samples into the attacker-visible prompt context."""
    projected: list[dict[str, str]] = []
    for record in records or []:
        if not isinstance(record, dict) or not _topic_matches(record, topic):
            continue
        item: dict[str, str] = {}
        for key in ("id", "topic", "content"):
            value = _text(record.get(key), limit=200 if key != "content" else _MAX_TEXT)
            if value is not None:
                item[key] = value
        if item.get("content"):
            projected.append(item)
        if len(projected) >= _MAX_RECORDS:
            break
    return {"role": "attacker", "records": projected}


def build_defender_knowledge(
    records: list[dict[str, Any]] | None,
    *,
    topic: str,
) -> dict[str, Any]:
    """Project defensive rules without exposing attacker samples or hidden truth."""
    projected: list[dict[str, str]] = []
    for record in records or []:
        if not isinstance(record, dict) or not _topic_matches(record, topic):
            continue
        item: dict[str, str] = {}
        for key in ("id", "name", "condition", "action"):
            value = _text(
                record.get(key), limit=200 if key != "condition" else _MAX_TEXT
            )
            if value is not None:
                item[key] = value
        if item.get("condition"):
            projected.append(item)
        if len(projected) >= _MAX_RECORDS:
            break
    return {"role": "defender", "records": projected}


def trusted_attacker_context(value: Any, *, topic: str) -> dict[str, Any] | None:
    """Re-project an untrusted payload context before an attacker model sees it."""
    if not isinstance(value, dict) or value.get("role") != "attacker":
        return None
    records = value.get("records")
    if not isinstance(records, list):
        return None
    context = build_attacker_knowledge(records, topic=topic)
    return context if context["records"] else None


def trusted_defender_context(value: Any, *, topic: str) -> dict[str, Any] | None:
    """Re-project an untrusted payload context before a defender model sees it."""
    if not isinstance(value, dict) or value.get("role") != "defender":
        return None
    records = value.get("records")
    if not isinstance(records, list):
        return None
    context = build_defender_knowledge(records, topic=topic)
    return context if context["records"] else None
