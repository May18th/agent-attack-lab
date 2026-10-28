"""Read-only adapter for the versioned role-scoped JSON libraries.

The catalogs are authored data.  This module only selects approved static
records for a battle; it never writes Payload variants, Attacker strategy
candidates, or Defender feature candidates.  Those learning pools remain
empty until the runtime review pipeline produces a candidate.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal

LibraryRole = Literal["common", "attacker", "defender", "arbiter"]
APPROVED = "approved"
_ROLES: tuple[LibraryRole, ...] = ("common", "attacker", "defender", "arbiter")


def library_root() -> Path:
    configured = os.getenv("AGENT_LIBRARY_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parents[2] / "data" / "libraries"


def _load(role: LibraryRole) -> dict[str, Any]:
    if role not in _ROLES:
        raise ValueError(f"unsupported library role: {role}")
    path = library_root() / role / "catalog.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {
            "role": role,
            "schemaVersion": "library.v1",
            "libraryVersion": "missing",
            "libraries": [],
        }
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid library catalog: {path}") from exc
    if not isinstance(value, dict) or value.get("role") != role:
        raise RuntimeError(f"library catalog role mismatch: {path}")
    if not isinstance(value.get("libraries"), list):
        raise TypeError(f"library catalog libraries must be an array: {path}")
    return value


def catalog() -> dict[str, Any]:
    """Return a safe summary of all role-scoped catalogs.

    The summary is useful for readiness checks and admin diagnostics.  It does
    not expose record bodies, and counts only records that the normal runtime
    selector would publish.
    """
    roles: list[dict[str, Any]] = []
    for role in _ROLES:
        value = _load(role)
        libraries: list[dict[str, Any]] = []
        for library in value.get("libraries", []):
            if not isinstance(library, dict):
                continue
            library_status = str(library.get("status") or APPROVED)
            published = 0
            for item in library.get("records", []):
                if not isinstance(item, dict):
                    continue
                record_status = str(
                    item.get("status")
                    or item.get("reviewStatus")
                    or library_status
                    or APPROVED
                )
                if library_status == APPROVED and record_status == APPROVED:
                    published += 1
            libraries.append(
                {
                    "libraryId": str(library.get("libraryId") or ""),
                    "name": str(library.get("name") or ""),
                    "status": library_status,
                    "recordCount": published,
                }
            )
        roles.append(
            {
                "role": role,
                "schemaVersion": value.get("schemaVersion", "library.v1"),
                "libraryVersion": value.get("libraryVersion", "unknown"),
                "libraries": libraries,
            }
        )
    return {"schemaVersion": "library.catalog.v1", "roles": roles}


def _theme_names() -> dict[str, str]:
    common = _load("common")
    names: dict[str, str] = {}
    for library in common.get("libraries", []):
        if not isinstance(library, dict) or library.get("libraryId") != "LIB-02":
            continue
        for record in library.get("records", []):
            if (
                isinstance(record, dict)
                and record.get("themeId")
                and record.get("name")
            ):
                names[str(record["themeId"])] = str(record["name"])
    return names


def _known_topic(topic: str | None) -> bool:
    """Whether a request selects one of the published formal themes."""
    requested = str(topic or "").strip().casefold()
    if not requested:
        return False
    return any(
        requested == name.casefold()
        or requested in name.casefold()
        or name.casefold() in requested
        for name in _theme_names().values()
    )


def _matches(
    record: dict[str, Any], *, topic: str | None, difficulty: str | None
) -> bool:
    if topic:
        requested = topic.strip().casefold()
        values = [str(record.get("topic") or "").strip().casefold()]
        theme_id = str(record.get("themeId") or "")
        if theme_id in _theme_names():
            values.append(_theme_names()[theme_id].casefold())
        if not any(
            value and (value in requested or requested in value) for value in values
        ):
            applicable = record.get("applicableThemes")
            if not isinstance(applicable, list) or theme_id not in applicable:
                return False
    if difficulty:
        value = record.get("difficulty") or record.get("allowedDifficulties")
        if isinstance(value, list) and difficulty not in value:
            return False
        if isinstance(value, str) and value != difficulty:
            return False
    return True


def records(
    role: LibraryRole,
    *,
    library_ids: set[str] | None = None,
    topic: str | None = None,
    difficulty: str | None = None,
    include_candidates: bool = False,
) -> dict[str, Any]:
    value = _load(role)
    selected: list[dict[str, Any]] = []
    names = _theme_names()
    for library in value.get("libraries", []):
        if not isinstance(library, dict):
            continue
        library_id = str(library.get("libraryId") or "")
        if library_ids and library_id not in library_ids:
            continue
        if (
            str(library.get("status") or APPROVED) != APPROVED
            and not include_candidates
        ):
            continue
        for item in library.get("records", []):
            if not isinstance(item, dict):
                continue
            status = str(
                item.get("status")
                or item.get("reviewStatus")
                or library.get("status")
                or APPROVED
            )
            if status != APPROVED and not include_candidates:
                continue
            if not _matches(item, topic=topic, difficulty=difficulty):
                continue
            selected.append(
                {
                    **item,
                    "id": item.get("id")
                    or item.get("sampleId")
                    or item.get("strategyId")
                    or item.get("ruleId"),
                    "topic": item.get("topic")
                    or names.get(str(item.get("themeId") or ""))
                    or topic,
                    "libraryId": library_id,
                    "status": status,
                    "libraryVersion": value.get("libraryVersion", "unknown"),
                }
            )
    return {
        "role": role,
        "schemaVersion": value.get("schemaVersion", "library.v1"),
        "libraryVersion": value.get("libraryVersion", "unknown"),
        "records": selected,
    }


def _attacker_context(*, topic: str, difficulty: str) -> dict[str, Any]:
    if not _known_topic(topic):
        return {
            "role": "attacker",
            "libraryVersion": _load("attacker").get("libraryVersion", "unknown"),
            "records": [],
            "selection": {
                "theme": topic,
                "difficulty": difficulty,
                "sampleLibrary": "LIB-03",
                "intentLibrary": "LIB-05",
                "sampleCount": 0,
                "intentCount": 0,
            },
        }
    samples = records(
        "attacker", library_ids={"LIB-03"}, topic=topic, difficulty=difficulty
    )["records"]
    strategies = records("attacker", library_ids={"LIB-05"}, difficulty=difficulty)[
        "records"
    ]
    # Keep both selections visible to the model within the existing bounded
    # records contract.  No learning or Payload-variant catalog is included.
    selected: list[dict[str, Any]] = []
    for item in samples[:5]:
        selected.append({**item, "selectionKind": "sample"})
    for item in strategies[:3]:
        selected.append(
            {
                **item,
                "selectionKind": "intent-strategy",
                "content": item.get("variationMethod") or item.get("intent") or "",
                "topic": topic,
            }
        )
    return {
        "role": "attacker",
        "libraryVersion": _load("attacker").get("libraryVersion", "unknown"),
        "records": selected,
        "selection": {
            "theme": topic,
            "difficulty": difficulty,
            "sampleLibrary": "LIB-03",
            "intentLibrary": "LIB-05",
            "sampleCount": len(samples),
            "intentCount": len(strategies),
        },
    }


def agent_context(
    role: Literal["attacker", "defender"], *, topic: str, difficulty: str
) -> dict[str, Any]:
    if role == "attacker":
        return _attacker_context(topic=topic, difficulty=difficulty)
    if not _known_topic(topic):
        return {
            "role": "defender",
            "libraryVersion": _load("defender").get("libraryVersion", "unknown"),
            "records": [],
            "selection": {"theme": topic, "difficulty": difficulty},
        }
    selected = records(
        "defender", library_ids={"LIB-09", "LIB-10", "LIB-11", "LIB-12"}, topic=topic
    )["records"]
    normalized: list[dict[str, Any]] = []
    for item in selected:
        condition = (
            item.get("condition")
            or item.get("risk")
            or item.get("match")
            or item.get("signals")
        )
        if isinstance(condition, list):
            condition = "；".join(str(value) for value in condition)
        if not condition:
            continue
        normalized.append(
            {
                **item,
                "id": item.get("id")
                or item.get("strategyId")
                or item.get("ruleId")
                or item.get("featureId")
                or item.get("toolRuleId"),
                "name": item.get("name")
                or item.get("focus")
                or item.get("checkId")
                or item.get("featureId"),
                "condition": str(condition),
                "action": item.get("action") or item.get("decision") or "review",
            }
        )
    return {
        "role": "defender",
        "libraryVersion": _load("defender").get("libraryVersion", "unknown"),
        "records": normalized,
        "selection": {"theme": topic, "difficulty": difficulty},
    }
