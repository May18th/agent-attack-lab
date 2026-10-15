from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any


class _PooledResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def fetchone(self) -> dict[str, Any] | None:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[dict[str, Any]]:
        return self._rows


class _PooledConnection:
    """Compatibility adapter for the store's single-statement operations."""

    def __init__(self, pool: Any) -> None:
        self._pool = pool

    def execute(self, statement: str, parameters: Any = ()) -> _PooledResult:
        with self._pool.connection() as connection:
            cursor = connection.execute(statement, parameters)
            rows = cursor.fetchall() if cursor.description else []
            connection.commit()
        return _PooledResult(rows)

    def commit(self) -> None:
        return


class _SqlAlchemyConnection:
    """Expose SQLAlchemy pooled connections through the store's small DB API."""

    def __init__(self, engine: Any) -> None:
        self._engine = engine

    def execute(self, statement: str, parameters: Any = ()) -> _PooledResult:
        with self._engine.begin() as connection:
            driver_parameters = tuple(parameters) if isinstance(parameters, list) else parameters
            result = connection.exec_driver_sql(statement, driver_parameters)
            rows = [dict(row) for row in result.mappings()] if result.returns_rows else []
        return _PooledResult(rows)

    def commit(self) -> None:
        return


class BattleStore:
    """Store battle records in SQLite, PostgreSQL, or pooled MySQL connections."""

    def __init__(self, database_path: str | None = None) -> None:
        configured_path = database_path or os.getenv("AGENT_BATTLE_DATABASE_URL") or os.getenv(
            "AGENT_BATTLE_DB", ".data/battles.sqlite3"
        )
        self._is_postgres = configured_path.startswith(("postgresql://", "postgres://", "postgresql+psycopg://"))
        self._is_mysql = configured_path.startswith(("mysql://", "mysql+pymysql://"))
        self._placeholder = "%s" if self._is_postgres or self._is_mysql else "?"
        self._lock = Lock()
        self._pool = None
        self._engine = None
        if self._is_postgres:
            try:
                from psycopg_pool import ConnectionPool
                from psycopg.rows import dict_row
            except ImportError as exc:
                raise RuntimeError(
                    "PostgreSQL 需要安装 psycopg[binary,pool]，或改用 AGENT_BATTLE_DB 指定 SQLite 文件。"
                ) from exc
            self._pool = ConnectionPool(
                conninfo=configured_path,
                min_size=1,
                max_size=max(2, int(os.getenv("AGENT_DB_POOL_MAX_SIZE", "10"))),
                timeout=10,
                kwargs={"row_factory": dict_row},
                open=True,
            )
            self._pool.wait(timeout=10)
            self._connection = _PooledConnection(self._pool)
        elif self._is_mysql:
            from sqlalchemy import create_engine
            from sqlalchemy.engine import make_url

            url = make_url(configured_path)
            if url.drivername == "mysql":
                url = url.set(drivername="mysql+pymysql")
            if url.drivername != "mysql+pymysql":
                raise ValueError("MySQL 连接串必须使用 mysql:// 或 mysql+pymysql://")
            if "charset" not in url.query:
                url = url.update_query_dict({"charset": "utf8mb4"})
            pool_size = max(2, int(os.getenv("AGENT_DB_POOL_MAX_SIZE", "10")))
            self._engine = create_engine(
                url,
                pool_size=pool_size,
                max_overflow=0,
                pool_pre_ping=True,
                pool_recycle=1800,
            )
            self._connection = _SqlAlchemyConnection(self._engine)
        else:
            if configured_path != ":memory:":
                Path(configured_path).parent.mkdir(parents=True, exist_ok=True)
            self._connection = sqlite3.connect(
                configured_path, check_same_thread=False, timeout=5.0
            )
            self._connection.row_factory = sqlite3.Row
            self._connection.execute("PRAGMA busy_timeout = 5000")
            if configured_path != ":memory:":
                self._connection.execute("PRAGMA journal_mode = WAL")
        if self._is_mysql:
            self._initialize_mysql_schema()
        elif not self._is_postgres:
            self._initialize_sqlite_schema()
        else:
            self._initialize_postgres_schema()

    def _initialize_sqlite_schema(self) -> None:
        self._connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
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
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_battle_events_type ON battle_events (event_type)"
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_battles_created ON battles (created_at DESC)"
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_battles_difficulty_created ON battles (difficulty, created_at DESC)"
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_battles_status_created ON battles (status, created_at DESC)"
        )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS battle_scores (
                battle_id TEXT PRIMARY KEY,
                scoring_version TEXT NOT NULL,
                score_json TEXT NOT NULL,
                computed_at TEXT NOT NULL
            )
            """
        )
        self._connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)"
        )
        self._connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version) VALUES (2)"
        )
        self._connection.commit()

    def _initialize_postgres_schema(self) -> None:
        self._connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
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
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_battle_events_type ON battle_events (event_type)"
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_battles_created ON battles (created_at DESC)"
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_battles_difficulty_created ON battles (difficulty, created_at DESC)"
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_battles_status_created ON battles (status, created_at DESC)"
        )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS battle_scores (
                battle_id TEXT PRIMARY KEY,
                scoring_version TEXT NOT NULL,
                score_json TEXT NOT NULL,
                computed_at TEXT NOT NULL
            )
            """
        )
        self._connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT (version) DO NOTHING"
        )
        self._connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (2) ON CONFLICT (version) DO NOTHING"
        )
        self._connection.commit()

    def _initialize_mysql_schema(self) -> None:
        self._connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS battles (
                id VARCHAR(191) PRIMARY KEY,
                difficulty VARCHAR(16) NOT NULL,
                topic TEXT NOT NULL,
                status VARCHAR(32) NOT NULL,
                created_at VARCHAR(40) NOT NULL,
                attacker_out LONGTEXT NOT NULL,
                defender_out LONGTEXT NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """
        )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS battle_events (
                id VARCHAR(191) PRIMARY KEY,
                battle_id VARCHAR(191) NOT NULL,
                sequence INTEGER NOT NULL,
                event_type VARCHAR(64) NOT NULL,
                status VARCHAR(32) NOT NULL,
                created_at VARCHAR(40) NOT NULL,
                data LONGTEXT NOT NULL,
                UNIQUE KEY uq_battle_event_sequence (battle_id, sequence)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """
        )
        indexes = {
            row["Key_name"]
            for row in self._connection.execute("SHOW INDEX FROM battle_events").fetchall()
        }
        if "idx_battle_events_battle" not in indexes:
            self._connection.execute(
                "CREATE INDEX idx_battle_events_battle ON battle_events (battle_id, sequence)"
            )
        if "idx_battle_events_type" not in indexes:
            self._connection.execute(
                "CREATE INDEX idx_battle_events_type ON battle_events (event_type)"
            )
        for name, columns in (
            ("idx_battles_created", "created_at DESC"),
            ("idx_battles_difficulty_created", "difficulty, created_at DESC"),
            ("idx_battles_status_created", "status, created_at DESC"),
        ):
            indexes = {
                row["Key_name"]
                for row in self._connection.execute("SHOW INDEX FROM battles").fetchall()
            }
            if name not in indexes:
                self._connection.execute(f"CREATE INDEX {name} ON battles ({columns})")
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS battle_scores (
                battle_id VARCHAR(191) PRIMARY KEY,
                scoring_version VARCHAR(64) NOT NULL,
                score_json LONGTEXT NOT NULL,
                computed_at VARCHAR(40) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """
        )
        self._connection.execute("INSERT IGNORE INTO schema_migrations (version) VALUES (1)")
        self._connection.execute("INSERT IGNORE INTO schema_migrations (version) VALUES (2)")
        self._connection.commit()

    def save(self, record: dict[str, Any]) -> None:
        with self._lock:
            values = (
                record["id"], record["difficulty"], record["topic"], record["status"],
                record["createdAt"], json.dumps(record["attackerOut"], ensure_ascii=False),
                json.dumps(record["defenderOut"], ensure_ascii=False),
            )
            if self._is_postgres:
                self._connection.execute(
                    """
                    INSERT INTO battles
                    (id, difficulty, topic, status, created_at, attacker_out, defender_out)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET difficulty=EXCLUDED.difficulty,
                    topic=EXCLUDED.topic, status=EXCLUDED.status, created_at=EXCLUDED.created_at,
                    attacker_out=EXCLUDED.attacker_out, defender_out=EXCLUDED.defender_out
                    """, values,
                )
            elif self._is_mysql:
                self._connection.execute(
                    """
                    INSERT INTO battles
                    (id, difficulty, topic, status, created_at, attacker_out, defender_out)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE difficulty=VALUES(difficulty), topic=VALUES(topic),
                    status=VALUES(status), created_at=VALUES(created_at),
                    attacker_out=VALUES(attacker_out), defender_out=VALUES(defender_out)
                    """, values,
                )
            else:
                self._connection.execute(
                    """
                    INSERT INTO battles
                    (id, difficulty, topic, status, created_at, attacker_out, defender_out)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET difficulty=excluded.difficulty,
                    topic=excluded.topic, status=excluded.status, created_at=excluded.created_at,
                    attacker_out=excluded.attacker_out, defender_out=excluded.defender_out
                    """, values,
                )
            self._connection.commit()

    def save_event(self, event: dict[str, Any]) -> None:
        """Persist one auditable step in a battle."""
        with self._lock:
            values = (
                event["id"], event["battleId"], event["sequence"], event["type"],
                event["status"], event["createdAt"], json.dumps(event.get("data", {}), ensure_ascii=False),
            )
            if self._is_postgres:
                self._connection.execute(
                    """
                    INSERT INTO battle_events
                    (id, battle_id, sequence, event_type, status, created_at, data)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, data=EXCLUDED.data
                    """, values,
                )
            elif self._is_mysql:
                self._connection.execute(
                    """
                    INSERT INTO battle_events
                    (id, battle_id, sequence, event_type, status, created_at, data)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE status=VALUES(status), data=VALUES(data)
                    """, values,
                )
            else:
                self._connection.execute(
                    """
                    INSERT INTO battle_events
                    (id, battle_id, sequence, event_type, status, created_at, data)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data
                    """, values,
                )
            self._connection.commit()

    def save_score(self, battle_id: str, score: dict[str, Any]) -> None:
        """Persist the evidence-derived score snapshot for a terminal battle."""
        values = (
            battle_id,
            str(score.get("version") or "unknown"),
            json.dumps(score, ensure_ascii=False),
            datetime.now(timezone.utc).isoformat(),
        )
        with self._lock:
            if self._is_postgres:
                self._connection.execute(
                    """
                    INSERT INTO battle_scores (battle_id, scoring_version, score_json, computed_at)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (battle_id) DO UPDATE SET
                        scoring_version=EXCLUDED.scoring_version,
                        score_json=EXCLUDED.score_json,
                        computed_at=EXCLUDED.computed_at
                    """, values,
                )
            elif self._is_mysql:
                self._connection.execute(
                    """
                    INSERT INTO battle_scores (battle_id, scoring_version, score_json, computed_at)
                    VALUES (%s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE scoring_version=VALUES(scoring_version),
                        score_json=VALUES(score_json), computed_at=VALUES(computed_at)
                    """, values,
                )
            else:
                self._connection.execute(
                    """
                    INSERT INTO battle_scores (battle_id, scoring_version, score_json, computed_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(battle_id) DO UPDATE SET
                        scoring_version=excluded.scoring_version,
                        score_json=excluded.score_json,
                        computed_at=excluded.computed_at
                    """, values,
                )
            self._connection.commit()

    def get_score(self, battle_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT score_json FROM battle_scores WHERE battle_id = " + self._placeholder,
                (battle_id,),
            ).fetchone()
        if row is None:
            return None
        try:
            score = json.loads(row["score_json"])
        except (TypeError, json.JSONDecodeError):
            return None
        return score if isinstance(score, dict) else None

    def list_scores(self, battle_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not battle_ids:
            return {}
        placeholders = ", ".join([self._placeholder] * len(battle_ids))
        with self._lock:
            rows = self._connection.execute(
                "SELECT battle_id, score_json FROM battle_scores WHERE battle_id IN ("
                + placeholders + ")",
                battle_ids,
            ).fetchall()
        scores: dict[str, dict[str, Any]] = {}
        for row in rows:
            try:
                score = json.loads(row["score_json"])
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(score, dict):
                scores[str(row["battle_id"])] = score
        return scores

    def delete_score(self, battle_id: str) -> None:
        with self._lock:
            self._connection.execute(
                "DELETE FROM battle_scores WHERE battle_id = " + self._placeholder,
                (battle_id,),
            )
            self._connection.commit()

    def get(self, battle_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM battles WHERE id = " + self._placeholder,
                (battle_id,),
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
        placeholder = self._placeholder
        where = where.replace("?", placeholder)
        with self._lock:
            rows = self._connection.execute(
                f"SELECT * FROM battles {where} ORDER BY created_at DESC LIMIT {placeholder} OFFSET {placeholder}",
                params,
            ).fetchall()
        return [self._to_record(row) for row in rows]

    def list_events(self, battle_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM battle_events WHERE battle_id = " + self._placeholder + " ORDER BY sequence",
                (battle_id,),
            ).fetchall()
        return [self._to_event(row) for row in rows]

    def list_events_after(self, battle_id: str, after_sequence: int) -> list[dict[str, Any]]:
        """Return only events newer than the caller's sequence cursor."""
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM battle_events WHERE battle_id = " + self._placeholder
                + " AND sequence > " + self._placeholder + " ORDER BY sequence",
                (battle_id, after_sequence),
            ).fetchall()
        return [self._to_event(row) for row in rows]

    def list_events_for_battles(self, battle_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        """Load event histories for a bounded set of battles in one query."""
        if not battle_ids:
            return {}
        placeholders = ", ".join([self._placeholder] * len(battle_ids))
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM battle_events WHERE battle_id IN (" + placeholders
                + ") ORDER BY battle_id, sequence",
                battle_ids,
            ).fetchall()
        grouped: dict[str, list[dict[str, Any]]] = {battle_id: [] for battle_id in battle_ids}
        for row in rows:
            event = self._to_event(row)
            grouped[event["battleId"]].append(event)
        return grouped

    def delete(self, battle_id: str) -> None:
        """Delete a battle and its event history."""
        with self._lock:
            self._connection.execute(
                "DELETE FROM battle_events WHERE battle_id = " + self._placeholder,
                (battle_id,),
            )
            self._connection.execute(
                "DELETE FROM battles WHERE id = " + self._placeholder,
                (battle_id,),
            )
            self._connection.execute(
                "DELETE FROM battle_scores WHERE battle_id = " + self._placeholder,
                (battle_id,),
            )
            self._connection.commit()

    def count(
        self,
        difficulty: str | None = None,
        status: str | None = None,
        query: str | None = None,
    ) -> int:
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
        placeholder = self._placeholder
        where = where.replace("?", placeholder)
        with self._lock:
            row = self._connection.execute(
                f"SELECT COUNT(*) AS total FROM battles {where}", params
            ).fetchone()
        return int(row["total"])

    def count_events(self) -> int:
        with self._lock:
            row = self._connection.execute("SELECT COUNT(*) AS total FROM battle_events").fetchone()
        return int(row["total"])

    def dashboard_summary(self) -> dict[str, int]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT status, difficulty, attacker_out, defender_out FROM battles"
            ).fetchall()
            call_events = self._connection.execute(
                "SELECT event_type, status, data FROM battle_events WHERE event_type IN ("
                + ", ".join([self._placeholder] * 2)
                + ")",
                ("agent.call.completed", "agent.call.failed"),
            ).fetchall()

        summary = {
            "totalBattles": len(rows),
            "completedBattles": 0,
            "failedBattles": 0,
            "highDifficultyBattles": 0,
            "sampleCount": 0,
            "ruleHitCount": 0,
            "riskCount": 0,
            "recommendationCount": 0,
            "simulationSampleCount": 0,
            "acpCallBattles": 0,
            "agentExecutionCount": 0,
            "acpRequestCount": 0,
            "acpSuccessCount": 0,
            "acpFailureCount": 0,
            "acpRuleFallbackCount": 0,
            "localRuleExecutionCount": 0,
            "reportedLlmResultCount": 0,
            "averageAgentCallLatencyMs": 0,
            "attackerCallCount": 0,
            "defenderCallCount": 0,
        }
        call_latencies: list[int] = []
        for event in call_events:
            data = json.loads(event["data"])
            dispatch_mode = data.get("dispatchMode")
            source = data.get("resultSource")
            summary["agentExecutionCount"] += 1
            role_key = {
                "attacker": "attackerCallCount",
                "defender": "defenderCallCount",
            }.get(data.get("agentRole"))
            if role_key:
                summary[role_key] += 1
            if dispatch_mode == "acp":
                summary["acpRequestCount"] += 1
                if event["event_type"] == "agent.call.completed":
                    summary["acpSuccessCount"] += 1
                elif event["event_type"] == "agent.call.failed":
                    summary["acpFailureCount"] += 1
                if source == "acp-rule-fallback":
                    summary["acpRuleFallbackCount"] += 1
                if source == "acp-llm":
                    summary["reportedLlmResultCount"] += 1
            elif dispatch_mode == "local" and event["event_type"] == "agent.call.completed":
                summary["localRuleExecutionCount"] += 1
            latency = data.get("durationMs")
            if isinstance(latency, int) and latency >= 0:
                call_latencies.append(latency)
        if call_latencies:
            summary["averageAgentCallLatencyMs"] = round(sum(call_latencies) / len(call_latencies))
        for row in rows:
            if row["status"] == "completed":
                summary["completedBattles"] += 1
            elif row["status"] == "failed":
                summary["failedBattles"] += 1
            if row["difficulty"] == "high":
                summary["highDifficultyBattles"] += 1

            attacker_out = json.loads(row["attacker_out"])
            samples = attacker_out.get("samples", [])
            defenses = json.loads(row["defender_out"])
            summary["sampleCount"] += len(samples)
            summary["simulationSampleCount"] += sum(
                sample.get("simulation") is True for sample in samples
            )
            summary["ruleHitCount"] += sum(
                len(defense.get("caught", [])) for defense in defenses
            )
            summary["riskCount"] += sum(
                len(defense.get("risks", [])) for defense in defenses
            )
            summary["recommendationCount"] += sum(
                len(defense.get("fixed", [])) for defense in defenses
            )
            if attacker_out.get("agentSource") == "acp" or str(attacker_out.get("agentSource", "")).startswith("acp-") or any(
                defense.get("agentSource") == "acp" or str(defense.get("agentSource", "")).startswith("acp-") for defense in defenses
            ):
                summary["acpCallBattles"] += 1
        return summary

    def close(self) -> None:
        if self._pool is not None:
            self._pool.close()
        if self._engine is not None:
            self._engine.dispose()

    @staticmethod
    def _to_record(row: Any) -> dict[str, Any]:
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
    def _to_event(row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "battleId": row["battle_id"],
            "sequence": row["sequence"],
            "type": row["event_type"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "data": json.loads(row["data"]),
        }
