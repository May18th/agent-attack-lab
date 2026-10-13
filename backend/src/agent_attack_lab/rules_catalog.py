"""Versioned, data-only rule catalog.

The catalog is deliberately separate from the executable local rule code.  A
catalog entry can be reviewed and tested for shape, but is never imported as
Python or evaluated by the battle engine.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_FORBIDDEN_KEYS = {"code", "python", "shell", "command", "exec", "eval"}


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _connect(database: Path) -> sqlite3.Connection:
    database.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS rules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            current_version INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rule_versions (
            rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
            version INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (rule_id, version)
        );
        """
    )
    return connection


def _validate_payload(payload: dict[str, Any]) -> None:
    if not isinstance(payload, dict) or not payload:
        raise ValueError("规则内容必须是非空对象")
    def walk(value: Any) -> set[str]:
        if isinstance(value, dict):
            found = {str(key).casefold() for key in value} & _FORBIDDEN_KEYS
            for child in value.values():
                found.update(walk(child))
            return found
        if isinstance(value, list):
            found: set[str] = set()
            for child in value:
                found.update(walk(child))
            return found
        return set()

    forbidden = sorted(walk(payload))
    if forbidden:
        raise ValueError(f"规则目录不接受可执行字段：{', '.join(forbidden)}")


def _version(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "ruleId": row["rule_id"],
        "version": row["version"],
        "payload": json.loads(row["payload_json"]),
        "createdAt": row["created_at"],
    }


def list_rules(database: Path) -> list[dict[str, Any]]:
    with _connect(database) as connection:
        rows = connection.execute(
            "SELECT * FROM rules ORDER BY updated_at DESC, id"
        ).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "currentVersion": row["current_version"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def get_rule(database: Path, rule_id: str) -> dict[str, Any] | None:
    with _connect(database) as connection:
        row = connection.execute("SELECT * FROM rules WHERE id = ?", (rule_id,)).fetchone()
        if row is None:
            return None
        version = connection.execute(
            "SELECT * FROM rule_versions WHERE rule_id = ? AND version = ?",
            (rule_id, row["current_version"]),
        ).fetchone()
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "currentVersion": row["current_version"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "payload": json.loads(version["payload_json"]),
    }


def list_versions(database: Path, rule_id: str) -> list[dict[str, Any]]:
    with _connect(database) as connection:
        rows = connection.execute(
            "SELECT * FROM rule_versions WHERE rule_id = ? ORDER BY version DESC", (rule_id,)
        ).fetchall()
    return [_version(row) for row in rows]


def create_rule(database: Path, *, name: str, description: str, payload: dict[str, Any], rule_id: str | None = None) -> dict[str, Any]:
    _validate_payload(payload)
    if not name.strip():
        raise ValueError("规则名称不能为空")
    rule_id = rule_id or f"rule-{uuid.uuid4()}"
    now = _now()
    with _connect(database) as connection:
        connection.execute(
            "INSERT INTO rules (id, name, description, current_version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
            (rule_id, name.strip(), description.strip(), now, now),
        )
        connection.execute(
            "INSERT INTO rule_versions (rule_id, version, payload_json, created_at) VALUES (?, 1, ?, ?)",
            (rule_id, json.dumps(payload, ensure_ascii=False, sort_keys=True), now),
        )
    return get_rule(database, rule_id) or {}


def update_rule(database: Path, rule_id: str, *, name: str | None = None, description: str | None = None, payload: dict[str, Any] | None = None) -> dict[str, Any] | None:
    current = get_rule(database, rule_id)
    if current is None:
        return None
    if payload is not None:
        _validate_payload(payload)
    if name is not None and not name.strip():
        raise ValueError("规则名称不能为空")
    now = _now()
    with _connect(database) as connection:
        next_version = int(current["currentVersion"]) + 1
        connection.execute(
            "UPDATE rules SET name = ?, description = ?, current_version = ?, updated_at = ? WHERE id = ?",
            (name.strip() if name is not None else current["name"], description.strip() if description is not None else current["description"], next_version, now, rule_id),
        )
        connection.execute(
            "INSERT INTO rule_versions (rule_id, version, payload_json, created_at) VALUES (?, ?, ?, ?)",
            (rule_id, next_version, json.dumps(payload if payload is not None else current["payload"], ensure_ascii=False, sort_keys=True), now),
        )
    return get_rule(database, rule_id)


def rollback_rule(database: Path, rule_id: str, version: int) -> dict[str, Any] | None:
    versions = {item["version"]: item for item in list_versions(database, rule_id)}
    target = versions.get(version)
    if target is None:
        return None
    return update_rule(database, rule_id, payload=target["payload"])


def delete_rule(database: Path, rule_id: str) -> bool:
    with _connect(database) as connection:
        result = connection.execute("DELETE FROM rules WHERE id = ?", (rule_id,))
        return result.rowcount > 0


def validate_rule(database: Path, rule_id: str, sample: dict[str, Any] | None = None) -> dict[str, Any] | None:
    rule = get_rule(database, rule_id)
    if rule is None:
        return None
    _validate_payload(rule["payload"])
    return {
        "ruleId": rule_id,
        "version": rule["currentVersion"],
        "valid": True,
        "execution": "catalog_only",
        "sampleProvided": sample is not None,
        "message": "规则已通过数据结构校验；目录内容不会直接执行。",
    }
