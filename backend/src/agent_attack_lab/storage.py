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
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS battle_events (
                id TEXT PRIMARY KEY,
                battle_id TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                data TEXT NOT NULL,
                UNIQUE (battle_id, sequence)
            )
            """
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_battle_events_battle ON battle_events (battle_id, sequence)"
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

    def save_event(self, event: dict[str, Any]) -> None:
        """Persist one auditable step in a battle."""
        with self._lock:
            self._connection.execute(
                """
                INSERT OR REPLACE INTO battle_events
                (id, battle_id, sequence, event_type, status, created_at, data)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event["id"],
                    event["battleId"],
                    event["sequence"],
                    event["type"],
                    event["status"],
                    event["createdAt"],
                    json.dumps(event.get("data", {}), ensure_ascii=False),
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

    def list(
        self,
        limit: int = 50,
        offset: int = 0,
        difficulty: str | None = None,
        status: str | None = None,
        query: str | None = None,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if difficulty:
            clauses.append("difficulty = ?")
            params.append(difficulty)
        if status:
            clauses.append("status = ?")
            params.append(status)
        if query:
            clauses.append("(topic LIKE ? OR id LIKE ?)")
            pattern = f"%{query}%"
            params.extend([pattern, pattern])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.extend([limit, offset])
        with self._lock:
            rows = self._connection.execute(
                f"SELECT * FROM battles {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
                params,
            ).fetchall()
        return [self._to_record(row) for row in rows]

    def list_events(self, battle_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM battle_events WHERE battle_id = ? ORDER BY sequence",
                (battle_id,),
            ).fetchall()
        return [self._to_event(row) for row in rows]

    def count(self) -> int:
        with self._lock:
            row = self._connection.execute("SELECT COUNT(*) AS total FROM battles").fetchone()
        return int(row["total"])

    def count_events(self) -> int:
        with self._lock:
            row = self._connection.execute("SELECT COUNT(*) AS total FROM battle_events").fetchone()
        return int(row["total"])

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

    @staticmethod
    def _to_event(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "battleId": row["battle_id"],
            "sequence": row["sequence"],
            "type": row["event_type"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "data": json.loads(row["data"]),
        }
