from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from threading import Lock
from typing import Any


class BattleStore:
    """Small SQLite store that keeps the existing API independent of ORM choice."""

    def __init__(self, database_path: str | None = None) -> None:
        configured_path = database_path or os.getenv(
            "AGENT_BATTLE_DB", ".data/battles.sqlite3"
        )
        if configured_path != ":memory:":
            Path(configured_path).parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(
            configured_path, check_same_thread=False
        )
        self._connection.row_factory = sqlite3.Row
        self._lock = Lock()
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS battles (
                id TEXT PRIMARY KEY,
                difficulty TEXT NOT NULL,
                topic TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                attacker_out TEXT NOT NULL,
                defender_out TEXT NOT NULL
            )
            """
        )
        self._connection.commit()

    def save(self, record: dict[str, Any]) -> None:
        with self._lock:
            self._connection.execute(
                """
                INSERT OR REPLACE INTO battles
                (id, difficulty, topic, status, created_at, attacker_out, defender_out)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record["id"],
                    record["difficulty"],
                    record["topic"],
                    record["status"],
                    record["createdAt"],
                    json.dumps(record["attackerOut"], ensure_ascii=False),
                    json.dumps(record["defenderOut"], ensure_ascii=False),
                ),
            )
            self._connection.commit()

    def get(self, battle_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM battles WHERE id = ?", (battle_id,)
            ).fetchone()
        if row is None:
            return None
        return self._to_record(row)

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM battles ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [self._to_record(row) for row in rows]

    @staticmethod
    def _to_record(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "difficulty": row["difficulty"],
            "topic": row["topic"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "attackerOut": json.loads(row["attacker_out"]),
            "defenderOut": json.loads(row["defender_out"]),
        }
