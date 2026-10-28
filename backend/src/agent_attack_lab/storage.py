from __future__ import annotations

import json
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any

_AUDIT_SENSITIVE_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "certificate",
    "key",
    "password",
    "private_key",
    "privatekey",
    "secret",
    "token",
}


def _sanitize_audit_data(value: Any) -> Any:
    """Keep audit records structured without persisting credentials or keys."""
    if isinstance(value, dict):
        return {
            str(key): _sanitize_audit_data(item)
            for key, item in value.items()
            if str(key).lower().replace("-", "_") not in _AUDIT_SENSITIVE_KEYS
        }
    if isinstance(value, list):
        return [_sanitize_audit_data(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _quote_identifier(column: str, *, is_postgres: bool) -> str:
    """按方言引用列名。

    ``condition`` 与 ``action`` 在 MySQL 里是保留字，不转义时 INSERT/UPDATE/SELECT
    会直接语法报错（SQLite 两种引号都认，PostgreSQL 只认双引号）。
    """
    return f'"{column}"' if is_postgres else f"`{column}`"


def _normalize_audit_time(value: str | None) -> str | None:
    """把审计筛选的时间边界统一成 created_at 的存储格式。

    ``created_at`` 由 ``datetime.now(UTC).isoformat()`` 写入，形如
    ``2026-10-28T10:53:51.960000+00:00``。前端 ``datetime-local`` 只给
    ``2026-10-28T18:53`` 这样的本地无时区值，直接做字符串比较会差一个时区；
    解析失败时退回原串，保证老数据/手工传参仍能查询。
    """
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return text
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")


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
            driver_parameters = (
                tuple(parameters) if isinstance(parameters, list) else parameters
            )
            result = connection.exec_driver_sql(statement, driver_parameters)
            rows = (
                [dict(row) for row in result.mappings()] if result.returns_rows else []
            )
        return _PooledResult(rows)

    def commit(self) -> None:
        return


class BattleStore:
    """Store battle records in SQLite, PostgreSQL, or pooled MySQL connections."""

    def __init__(self, database_path: str | None = None) -> None:
        configured_path = (
            database_path
            or os.getenv("AGENT_BATTLE_DATABASE_URL")
            or os.getenv("AGENT_BATTLE_DB", ".data/battles.sqlite3")
        )
        self._is_postgres = configured_path.startswith(
            ("postgresql://", "postgres://", "postgresql+psycopg://")
        )
        self._is_mysql = configured_path.startswith(("mysql://", "mysql+pymysql://"))
        self._placeholder = "%s" if self._is_postgres or self._is_mysql else "?"
        self._lock = Lock()
        self._pool = None
        self._engine = None
        self._closed = False
        if self._is_postgres:
            try:
                from psycopg.rows import dict_row
                from psycopg_pool import ConnectionPool
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
        self._ensure_battle_code_schema()
        self._initialize_admin_library_schema()

    def _ensure_battle_code_schema(self) -> None:
        """Add optional battle metadata columns and the human-readable code sequence."""
        if self._is_postgres:
            self._connection.execute(
                "ALTER TABLE battles ADD COLUMN IF NOT EXISTS code VARCHAR(16) NULL"
            )
            self._connection.execute(
                "ALTER TABLE battles ADD COLUMN IF NOT EXISTS rounds INTEGER NOT NULL DEFAULT 3"
            )
            self._connection.execute(
                "ALTER TABLE battles ADD COLUMN IF NOT EXISTS verdict VARCHAR(32) NULL"
            )
            self._connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_battles_code ON battles (code)"
            )
            self._connection.execute(
                "CREATE TABLE IF NOT EXISTS battle_code_sequence (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)"
            )
            self._connection.execute(
                "INSERT INTO battle_code_sequence (id, value) VALUES (1, 0) ON CONFLICT (id) DO NOTHING"
            )
        elif self._is_mysql:
            columns = self._connection.execute(
                "SHOW COLUMNS FROM battles LIKE 'code'"
            ).fetchall()
            if not columns:
                self._connection.execute(
                    "ALTER TABLE battles ADD COLUMN code VARCHAR(16) NULL"
                )
            columns = {
                row["Field"]
                for row in self._connection.execute(
                    "SHOW COLUMNS FROM battles"
                ).fetchall()
            }
            if "rounds" not in columns:
                self._connection.execute(
                    "ALTER TABLE battles ADD COLUMN rounds INTEGER NOT NULL DEFAULT 3"
                )
            if "verdict" not in columns:
                self._connection.execute(
                    "ALTER TABLE battles ADD COLUMN verdict VARCHAR(32) NULL"
                )
            indexes = {
                row["Key_name"]
                for row in self._connection.execute(
                    "SHOW INDEX FROM battles"
                ).fetchall()
            }
            if "uq_battles_code" not in indexes:
                self._connection.execute(
                    "CREATE UNIQUE INDEX uq_battles_code ON battles (code)"
                )
            self._connection.execute(
                "CREATE TABLE IF NOT EXISTS battle_code_sequence (id INTEGER PRIMARY KEY, value INTEGER NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
            )
            self._connection.execute(
                "INSERT IGNORE INTO battle_code_sequence (id, value) VALUES (1, 0)"
            )
        else:
            columns = {
                row["name"]
                for row in self._connection.execute(
                    "PRAGMA table_info(battles)"
                ).fetchall()
            }
            if "code" not in columns:
                self._connection.execute(
                    "ALTER TABLE battles ADD COLUMN code VARCHAR(16) NULL"
                )
            if "rounds" not in columns:
                self._connection.execute(
                    "ALTER TABLE battles ADD COLUMN rounds INTEGER NOT NULL DEFAULT 3"
                )
            if "verdict" not in columns:
                self._connection.execute(
                    "ALTER TABLE battles ADD COLUMN verdict VARCHAR(32) NULL"
                )
            self._connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_battles_code ON battles (code)"
            )
            self._connection.execute(
                "CREATE TABLE IF NOT EXISTS battle_code_sequence (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)"
            )
            self._connection.execute(
                "INSERT OR IGNORE INTO battle_code_sequence (id, value) VALUES (1, 0)"
            )
        self._connection.commit()

    def next_battle_code(self) -> str:
        """Atomically allocate the next human-readable battle code."""
        with self._lock:
            if self._is_postgres:
                row = self._connection.execute(
                    "UPDATE battle_code_sequence SET value = value + 1 WHERE id = 1 RETURNING value"
                ).fetchone()
            elif self._is_mysql:
                with self._engine.begin() as connection:
                    connection.exec_driver_sql(
                        "UPDATE battle_code_sequence SET value = value + 1 WHERE id = 1"
                    )
                    result = connection.exec_driver_sql(
                        "SELECT value FROM battle_code_sequence WHERE id = %s", (1,)
                    )
                    row = result.mappings().first()
            else:
                self._connection.execute(
                    "UPDATE battle_code_sequence SET value = value + 1 WHERE id = 1"
                )
                row = self._connection.execute(
                    "SELECT value FROM battle_code_sequence WHERE id = "
                    + self._placeholder,
                    (1,),
                ).fetchone()
            self._connection.commit()
        return f"A-{int(row['value']):03d}"

    def _initialize_sqlite_schema(self) -> None:
        self._connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS battles (
                id TEXT PRIMARY KEY,
                code VARCHAR(16) UNIQUE NULL,
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
            """
            CREATE TABLE IF NOT EXISTS audit_events (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                request_id TEXT,
                battle_id TEXT,
                correlation_id TEXT,
                actor_role TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                data TEXT NOT NULL
            )
            """
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_events_battle ON audit_events (battle_id, created_at)"
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_events_request ON audit_events (request_id, created_at)"
        )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS battle_idempotency (
                idempotency_key TEXT PRIMARY KEY,
                request_fingerprint TEXT NOT NULL,
                battle_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        self._connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)"
        )
        self._connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version) VALUES (2)"
        )
        self._connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version) VALUES (3)"
        )
        self._connection.commit()

    def _initialize_admin_library_schema(self) -> None:
        """Create administrator-managed sample and rule libraries."""
        if self._is_postgres:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_samples (
                    id VARCHAR(191) PRIMARY KEY, topic TEXT NOT NULL, content TEXT NOT NULL,
                    source TEXT NOT NULL, use_count INTEGER NOT NULL DEFAULT 0,
                    created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL
                )
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_rules (
                    id VARCHAR(191) PRIMARY KEY, name TEXT NOT NULL, condition TEXT NOT NULL,
                    action TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0,
                    created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL
                )
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_library_meta (
                    meta_key VARCHAR(191) PRIMARY KEY, meta_value TEXT NOT NULL
                )
                """
            )
        elif self._is_mysql:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_samples (
                    id VARCHAR(191) PRIMARY KEY, topic TEXT NOT NULL, content TEXT NOT NULL,
                    source TEXT NOT NULL, use_count INTEGER NOT NULL DEFAULT 0,
                    created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_rules (
                    id VARCHAR(191) PRIMARY KEY, name TEXT NOT NULL, `condition` TEXT NOT NULL,
                    `action` TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0,
                    created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_library_meta (
                    meta_key VARCHAR(191) PRIMARY KEY, meta_value TEXT NOT NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
        else:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_samples (
                    id TEXT PRIMARY KEY, topic TEXT NOT NULL, content TEXT NOT NULL,
                    source TEXT NOT NULL, use_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                )
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_rules (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, condition TEXT NOT NULL,
                    action TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                )
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_library_meta (
                    meta_key TEXT PRIMARY KEY, meta_value TEXT NOT NULL
                )
                """
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
                code VARCHAR(16) UNIQUE NULL,
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
            """
            CREATE TABLE IF NOT EXISTS audit_events (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                request_id TEXT,
                battle_id TEXT,
                correlation_id TEXT,
                actor_role TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                data TEXT NOT NULL
            )
            """
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_events_battle ON audit_events (battle_id, created_at)"
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_events_request ON audit_events (request_id, created_at)"
        )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS battle_idempotency (
                idempotency_key TEXT PRIMARY KEY,
                request_fingerprint TEXT NOT NULL,
                battle_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        self._connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT (version) DO NOTHING"
        )
        self._connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (2) ON CONFLICT (version) DO NOTHING"
        )
        self._connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (3) ON CONFLICT (version) DO NOTHING"
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
                code VARCHAR(16) UNIQUE NULL,
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
            for row in self._connection.execute(
                "SHOW INDEX FROM battle_events"
            ).fetchall()
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
                for row in self._connection.execute(
                    "SHOW INDEX FROM battles"
                ).fetchall()
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
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_events (
                id VARCHAR(191) PRIMARY KEY,
                event_type VARCHAR(128) NOT NULL,
                request_id VARCHAR(191) NULL,
                battle_id VARCHAR(191) NULL,
                correlation_id VARCHAR(191) NULL,
                actor_role VARCHAR(64) NULL,
                status VARCHAR(32) NOT NULL,
                created_at VARCHAR(40) NOT NULL,
                data LONGTEXT NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """
        )
        for name, columns in (
            ("idx_audit_events_battle", "battle_id, created_at"),
            ("idx_audit_events_request", "request_id, created_at"),
        ):
            indexes = {
                row["Key_name"]
                for row in self._connection.execute(
                    "SHOW INDEX FROM audit_events"
                ).fetchall()
            }
            if name not in indexes:
                self._connection.execute(
                    f"CREATE INDEX {name} ON audit_events ({columns})"
                )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS battle_idempotency (
                idempotency_key VARCHAR(191) PRIMARY KEY,
                request_fingerprint VARCHAR(64) NOT NULL,
                battle_id VARCHAR(191) NOT NULL,
                created_at VARCHAR(40) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """
        )
        self._connection.execute(
            "INSERT IGNORE INTO schema_migrations (version) VALUES (1)"
        )
        self._connection.execute(
            "INSERT IGNORE INTO schema_migrations (version) VALUES (2)"
        )
        self._connection.execute(
            "INSERT IGNORE INTO schema_migrations (version) VALUES (3)"
        )
        self._connection.commit()

    def save(self, record: dict[str, Any]) -> None:
        with self._lock:
            values = (
                record["id"],
                record.get("code"),
                record["difficulty"],
                record["topic"],
                record["status"],
                record["createdAt"],
                json.dumps(record["attackerOut"], ensure_ascii=False),
                json.dumps(record["defenderOut"], ensure_ascii=False),
                record.get("rounds", 3),
                record.get("verdict"),
            )
            if self._is_postgres:
                self._connection.execute(
                    """
                    INSERT INTO battles
                    (id, code, difficulty, topic, status, created_at, attacker_out, defender_out, rounds, verdict)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET difficulty=EXCLUDED.difficulty,
                    topic=EXCLUDED.topic, status=EXCLUDED.status, created_at=EXCLUDED.created_at,
                    attacker_out=EXCLUDED.attacker_out, defender_out=EXCLUDED.defender_out, code=EXCLUDED.code,
                    rounds=EXCLUDED.rounds, verdict=EXCLUDED.verdict
                    """,
                    values,
                )
            elif self._is_mysql:
                self._connection.execute(
                    """
                    INSERT INTO battles
                    (id, code, difficulty, topic, status, created_at, attacker_out, defender_out, rounds, verdict)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE difficulty=VALUES(difficulty), topic=VALUES(topic),
                    status=VALUES(status), created_at=VALUES(created_at),
                    attacker_out=VALUES(attacker_out), defender_out=VALUES(defender_out), code=VALUES(code),
                    rounds=VALUES(rounds), verdict=VALUES(verdict)
                    """,
                    values,
                )
            else:
                self._connection.execute(
                    """
                    INSERT INTO battles
                    (id, code, difficulty, topic, status, created_at, attacker_out, defender_out, rounds, verdict)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET difficulty=excluded.difficulty,
                    topic=excluded.topic, status=excluded.status, created_at=excluded.created_at,
                    attacker_out=excluded.attacker_out, defender_out=excluded.defender_out, code=excluded.code,
                    rounds=excluded.rounds, verdict=excluded.verdict
                    """,
                    values,
                )
            self._connection.commit()

    def save_event(self, event: dict[str, Any]) -> None:
        """Persist one auditable step in a battle."""
        with self._lock:
            values = (
                event["id"],
                event["battleId"],
                event["sequence"],
                event["type"],
                event["status"],
                event["createdAt"],
                json.dumps(event.get("data", {}), ensure_ascii=False),
            )
            if self._is_postgres:
                self._connection.execute(
                    """
                    INSERT INTO battle_events
                    (id, battle_id, sequence, event_type, status, created_at, data)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, data=EXCLUDED.data
                    """,
                    values,
                )
            elif self._is_mysql:
                self._connection.execute(
                    """
                    INSERT INTO battle_events
                    (id, battle_id, sequence, event_type, status, created_at, data)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE status=VALUES(status), data=VALUES(data)
                    """,
                    values,
                )
            else:
                self._connection.execute(
                    """
                    INSERT INTO battle_events
                    (id, battle_id, sequence, event_type, status, created_at, data)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data
                    """,
                    values,
                )
            self._connection.commit()

    def save_score(self, battle_id: str, score: dict[str, Any]) -> None:
        """Persist the evidence-derived score snapshot for a terminal battle."""
        values = (
            battle_id,
            str(score.get("version") or "unknown"),
            json.dumps(score, ensure_ascii=False),
            datetime.now(UTC).isoformat(),
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
                    """,
                    values,
                )
            elif self._is_mysql:
                self._connection.execute(
                    """
                    INSERT INTO battle_scores (battle_id, scoring_version, score_json, computed_at)
                    VALUES (%s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE scoring_version=VALUES(scoring_version),
                        score_json=VALUES(score_json), computed_at=VALUES(computed_at)
                    """,
                    values,
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
                    """,
                    values,
                )
            self._connection.commit()

    def get_score(self, battle_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT score_json FROM battle_scores WHERE battle_id = "
                + self._placeholder,
                (battle_id,),
            ).fetchone()
        if row is None:
            return None
        try:
            score = json.loads(row["score_json"])
        except TypeError, json.JSONDecodeError:
            return None
        return score if isinstance(score, dict) else None

    def list_scores(self, battle_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not battle_ids:
            return {}
        placeholders = ", ".join([self._placeholder] * len(battle_ids))
        with self._lock:
            rows = self._connection.execute(
                "SELECT battle_id, score_json FROM battle_scores WHERE battle_id IN ("
                + placeholders
                + ")",
                battle_ids,
            ).fetchall()
        scores: dict[str, dict[str, Any]] = {}
        for row in rows:
            try:
                score = json.loads(row["score_json"])
            except TypeError, json.JSONDecodeError:
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

    def save_audit_event(self, event: dict[str, Any]) -> None:
        """Persist one sanitized cross-request audit record."""
        values = (
            event["id"],
            event["eventType"],
            event.get("requestId"),
            event.get("battleId"),
            event.get("correlationId"),
            event.get("actorRole"),
            event["status"],
            event["createdAt"],
            json.dumps(_sanitize_audit_data(event.get("data", {})), ensure_ascii=False),
        )
        with self._lock:
            if self._is_postgres:
                self._connection.execute(
                    """
                    INSERT INTO audit_events
                    (id, event_type, request_id, battle_id, correlation_id, actor_role, status, created_at, data)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, data=EXCLUDED.data
                    """,
                    values,
                )
            elif self._is_mysql:
                self._connection.execute(
                    """
                    INSERT INTO audit_events
                    (id, event_type, request_id, battle_id, correlation_id, actor_role, status, created_at, data)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE status=VALUES(status), data=VALUES(data)
                    """,
                    values,
                )
            else:
                self._connection.execute(
                    """
                    INSERT INTO audit_events
                    (id, event_type, request_id, battle_id, correlation_id, actor_role, status, created_at, data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data
                    """,
                    values,
                )
            self._connection.commit()

    def list_audit_events(
        self,
        *,
        battle_id: str | None = None,
        request_id: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if battle_id:
            clauses.append("battle_id = " + self._placeholder)
            params.append(battle_id)
        if request_id:
            clauses.append("request_id = " + self._placeholder)
            params.append(request_id)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        params.append(limit)
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM audit_events"
                + where
                + " ORDER BY created_at, id LIMIT "
                + self._placeholder,
                params,
            ).fetchall()
        return [
            {
                "id": row["id"],
                "eventType": row["event_type"],
                "requestId": row["request_id"],
                "battleId": row["battle_id"],
                "correlationId": row["correlation_id"],
                "actorRole": row["actor_role"],
                "status": row["status"],
                "createdAt": row["created_at"],
                "data": json.loads(row["data"]),
            }
            for row in rows
        ]

    def count_audit_events(self) -> int:
        with self._lock:
            row = self._connection.execute(
                "SELECT COUNT(*) AS total FROM audit_events"
            ).fetchone()
        return int(row["total"])

    def get_admin_library_meta(self, key: str) -> str | None:
        """Read a bootstrap marker for the admin libraries (e.g. seeded-once)."""
        with self._lock:
            row = self._connection.execute(
                "SELECT meta_value FROM admin_library_meta WHERE meta_key = "
                + self._placeholder,
                (key,),
            ).fetchone()
        return str(row["meta_value"]) if row is not None else None

    def delete_admin_library_meta(self, key: str) -> None:
        """清掉初始化标记，让下次启动重新补齐内置示例（运维/测试用）。"""
        with self._lock:
            self._connection.execute(
                "DELETE FROM admin_library_meta WHERE meta_key = " + self._placeholder,
                (key,),
            )
            self._connection.commit()

    def set_admin_library_meta(self, key: str, value: str) -> None:
        with self._lock:
            if self._is_postgres:
                sql = (
                    "INSERT INTO admin_library_meta (meta_key, meta_value) "
                    "VALUES (%s, %s) ON CONFLICT (meta_key) "
                    "DO UPDATE SET meta_value = EXCLUDED.meta_value"
                )
            elif self._is_mysql:
                sql = (
                    "INSERT INTO admin_library_meta (meta_key, meta_value) "
                    "VALUES (%s, %s) ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)"
                )
            else:
                sql = (
                    "INSERT INTO admin_library_meta (meta_key, meta_value) "
                    "VALUES (?, ?) ON CONFLICT(meta_key) "
                    "DO UPDATE SET meta_value = excluded.meta_value"
                )
            self._connection.execute(sql, (key, value))
            self._connection.commit()

    def _col(self, name: str) -> str:
        """MySQL 的 condition/action 不做转义会直接语法报错。"""
        return _quote_identifier(name, is_postgres=self._is_postgres)

    @staticmethod
    def _library_record(row: dict[str, Any], kind: str) -> dict[str, Any]:
        if kind == "sample":
            return {
                "id": row["id"],
                "topic": row["topic"],
                "content": row["content"],
                "source": row["source"],
                "useCount": int(row["use_count"]),
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
        return {
            "id": row["id"],
            "name": row["name"],
            "condition": row["condition"],
            "action": row["action"],
            "hitCount": int(row["hit_count"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    def save_admin_sample(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC).isoformat()
        record = {
            "id": str(payload.get("id") or f"sample-{os.urandom(8).hex()}"),
            "topic": str(payload.get("topic") or "通用安全测试").strip(),
            "content": str(payload.get("content") or "").strip(),
            "source": str(payload.get("source") or "管理员录入").strip(),
            "use_count": int(payload.get("useCount") or 0),
            "created_at": now,
            "updated_at": now,
        }
        with self._lock:
            values = tuple(record.values())
            if self._is_postgres or self._is_mysql:
                sql = "INSERT INTO admin_samples (id, topic, content, source, use_count, created_at, updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s)"
            else:
                sql = "INSERT INTO admin_samples (id, topic, content, source, use_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
            self._connection.execute(sql, values)
            self._connection.commit()
        return self._library_record(record, "sample")

    def list_admin_samples(
        self, query: str | None = None, limit: int = 200, offset: int = 0
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if query:
            operator = "ILIKE" if self._is_postgres else "LIKE"
            clauses.append(
                f"(topic {operator} {self._placeholder} OR content {operator} {self._placeholder} OR source {operator} {self._placeholder})"
            )
            value = f"%{query}%"
            params.extend([value, value, value])
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        params.extend([limit, offset])
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM admin_samples"
                + where
                + " ORDER BY created_at DESC LIMIT "
                + self._placeholder
                + " OFFSET "
                + self._placeholder,
                params,
            ).fetchall()
        return [self._library_record(row, "sample") for row in rows]

    def update_admin_sample(
        self, sample_id: str, changes: dict[str, Any]
    ) -> dict[str, Any] | None:
        allowed = {
            "topic": "topic",
            "content": "content",
            "source": "source",
            "useCount": "use_count",
        }
        updates = [
            (column, changes[key]) for key, column in allowed.items() if key in changes
        ]
        if not updates:
            rows = self.list_admin_samples()
            return next((item for item in rows if item["id"] == sample_id), None)
        updates.append(("updated_at", datetime.now(UTC).isoformat()))
        assignments = ", ".join(
            f"{column} = {self._placeholder}" for column, _ in updates
        )
        params = [value for _, value in updates] + [sample_id]
        with self._lock:
            self._connection.execute(
                "UPDATE admin_samples SET "
                + assignments
                + " WHERE id = "
                + self._placeholder,
                params,
            )
            self._connection.commit()
        return next(
            (item for item in self.list_admin_samples() if item["id"] == sample_id),
            None,
        )

    def delete_admin_sample(self, sample_id: str) -> bool:
        with self._lock:
            result = self._connection.execute(
                "DELETE FROM admin_samples WHERE id = " + self._placeholder,
                (sample_id,),
            )
            self._connection.commit()
        return bool(getattr(result, "rowcount", 1))

    def save_admin_rule(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(UTC).isoformat()
        record = {
            "id": str(payload.get("id") or f"rule-{os.urandom(8).hex()}"),
            "name": str(payload.get("name") or "未命名规则").strip(),
            "condition": str(payload.get("condition") or "").strip(),
            "action": str(payload.get("action") or "拦截").strip(),
            "hit_count": int(payload.get("hitCount") or 0),
            "created_at": now,
            "updated_at": now,
        }
        with self._lock:
            values = tuple(record.values())
            sql = (
                "INSERT INTO admin_rules (id, name, "
                + self._col("condition")
                + ", "
                + self._col("action")
                + ", hit_count, created_at, updated_at) VALUES ("
                + ",".join([self._placeholder] * 7)
                + ")"
            )
            self._connection.execute(sql, values)
            self._connection.commit()
        return self._library_record(record, "rule")

    def list_admin_rules(
        self, query: str | None = None, limit: int = 200, offset: int = 0
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if query:
            operator = "ILIKE" if self._is_postgres else "LIKE"
            clauses.append(
                f"(name {operator} {self._placeholder} OR "
                f"{self._col('condition')} {operator} {self._placeholder})"
            )
            params.extend([f"%{query}%", f"%{query}%"])
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        params.extend([limit, offset])
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM admin_rules"
                + where
                + " ORDER BY created_at DESC LIMIT "
                + self._placeholder
                + " OFFSET "
                + self._placeholder,
                params,
            ).fetchall()
        return [self._library_record(row, "rule") for row in rows]

    def update_admin_rule(
        self, rule_id: str, changes: dict[str, Any]
    ) -> dict[str, Any] | None:
        allowed = {
            "name": "name",
            "condition": "condition",
            "action": "action",
            "hitCount": "hit_count",
        }
        updates = [
            (column, changes[key]) for key, column in allowed.items() if key in changes
        ]
        if not updates:
            return next(
                (item for item in self.list_admin_rules() if item["id"] == rule_id),
                None,
            )
        updates.append(("updated_at", datetime.now(UTC).isoformat()))
        assignments = ", ".join(
            f"{self._col(column)} = {self._placeholder}" for column, _ in updates
        )
        params = [value for _, value in updates] + [rule_id]
        with self._lock:
            self._connection.execute(
                "UPDATE admin_rules SET "
                + assignments
                + " WHERE id = "
                + self._placeholder,
                params,
            )
            self._connection.commit()
        return next(
            (item for item in self.list_admin_rules() if item["id"] == rule_id), None
        )

    def delete_admin_rule(self, rule_id: str) -> bool:
        with self._lock:
            result = self._connection.execute(
                "DELETE FROM admin_rules WHERE id = " + self._placeholder, (rule_id,)
            )
            self._connection.commit()
        return bool(getattr(result, "rowcount", 1))

    def list_audit_events_filtered(
        self,
        *,
        from_time: str | None = None,
        to_time: str | None = None,
        actor_role: str | None = None,
        event_type: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        # 时间列存的是 UTC ISO 串（带 +00:00 和微秒），前端 datetime-local 给的是本地
        # 无时区值；必须先归一化，否则筛选边界会整体偏掉时区差。
        normalized_from = _normalize_audit_time(from_time)
        normalized_to = _normalize_audit_time(to_time)
        if normalized_from:
            clauses.append(f"created_at >= {self._placeholder}")
            params.append(normalized_from)
        if normalized_to:
            clauses.append(f"created_at <= {self._placeholder}")
            params.append(normalized_to)
        # 角色与操作类型按子串匹配：缓存里存的是 admin.sample.created 这类全名，
        # 精确等值会让「样本」「admin」这类人话输入永远查不到东西。
        if actor_role and actor_role.strip():
            clauses.append(f"actor_role LIKE {self._placeholder}")
            params.append(f"%{actor_role.strip()}%")
        if event_type and event_type.strip():
            clauses.append(f"event_type LIKE {self._placeholder}")
            params.append(f"%{event_type.strip()}%")
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        params.append(limit)
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM audit_events"
                + where
                + " ORDER BY created_at DESC, id DESC LIMIT "
                + self._placeholder,
                params,
            ).fetchall()
        return [
            {
                "id": row["id"],
                "eventType": row["event_type"],
                "requestId": row["request_id"],
                "battleId": row["battle_id"],
                "correlationId": row["correlation_id"],
                "actorRole": row["actor_role"],
                "status": row["status"],
                "createdAt": row["created_at"],
                "data": json.loads(row["data"]),
            }
            for row in rows
        ]

    def get_idempotency(self, key: str) -> dict[str, str] | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT idempotency_key, request_fingerprint, battle_id, created_at "
                "FROM battle_idempotency WHERE idempotency_key = " + self._placeholder,
                (key,),
            ).fetchone()
        if row is None:
            return None
        return {
            "key": row["idempotency_key"],
            "fingerprint": row["request_fingerprint"],
            "battleId": row["battle_id"],
            "createdAt": row["created_at"],
        }

    def save_idempotency(self, key: str, fingerprint: str, battle_id: str) -> None:
        values = (key, fingerprint, battle_id, datetime.now(UTC).isoformat())
        with self._lock:
            if self._is_postgres:
                self._connection.execute(
                    """
                    INSERT INTO battle_idempotency (idempotency_key, request_fingerprint, battle_id, created_at)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (idempotency_key) DO NOTHING
                    """,
                    values,
                )
            elif self._is_mysql:
                self._connection.execute(
                    """
                    INSERT IGNORE INTO battle_idempotency
                    (idempotency_key, request_fingerprint, battle_id, created_at)
                    VALUES (%s, %s, %s, %s)
                    """,
                    values,
                )
            else:
                self._connection.execute(
                    """
                    INSERT INTO battle_idempotency (idempotency_key, request_fingerprint, battle_id, created_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(idempotency_key) DO NOTHING
                    """,
                    values,
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
            clauses.append("(topic LIKE ? OR id LIKE ? OR code LIKE ?)")
            pattern = f"%{query}%"
            params.extend([pattern, pattern, pattern])
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

    def list_outputs(self, limit: int = 100000) -> list[dict[str, Any]]:
        """Read the latest battle outputs without materializing unused metadata."""
        with self._lock:
            rows = self._connection.execute(
                "SELECT attacker_out, defender_out FROM battles "
                f"ORDER BY created_at DESC LIMIT {self._placeholder} OFFSET 0",
                (limit,),
            ).fetchall()
        return [
            {
                "attackerOut": json.loads(row["attacker_out"]),
                "defenderOut": json.loads(row["defender_out"]),
            }
            for row in rows
        ]

    def list_events(self, battle_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM battle_events WHERE battle_id = "
                + self._placeholder
                + " ORDER BY sequence",
                (battle_id,),
            ).fetchall()
        return [self._to_event(row) for row in rows]

    def list_events_after(
        self, battle_id: str, after_sequence: int
    ) -> list[dict[str, Any]]:
        """Return only events newer than the caller's sequence cursor."""
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM battle_events WHERE battle_id = "
                + self._placeholder
                + " AND sequence > "
                + self._placeholder
                + " ORDER BY sequence",
                (battle_id, after_sequence),
            ).fetchall()
        return [self._to_event(row) for row in rows]

    def query_events(
        self,
        battle_id: str,
        *,
        limit: int,
        after_sequence: int = 0,
        event_type: str | None = None,
        from_time: str | None = None,
        to_time: str | None = None,
        query: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        """Return one filtered event page and the total matching event count."""
        filter_clauses = ["battle_id = ?"]
        filter_params: list[Any] = [battle_id]
        if event_type:
            filter_clauses.append("event_type = ?")
            filter_params.append(event_type)
        if from_time:
            filter_clauses.append("created_at >= ?")
            filter_params.append(from_time)
        if to_time:
            filter_clauses.append("created_at <= ?")
            filter_params.append(to_time)
        if query:
            pattern = f"%{query.lower()}%"
            data_type = "CHAR" if self._is_mysql else "TEXT"
            filter_clauses.append(
                "(LOWER(event_type) LIKE ? OR LOWER(CAST(data AS "
                + data_type
                + ")) LIKE ?)"
            )
            filter_params.extend([pattern, pattern])
        filter_where = " WHERE " + " AND ".join(filter_clauses)
        page_where = filter_where + " AND sequence > " + self._placeholder
        page_params = [*filter_params, after_sequence]
        with self._lock:
            total_row = self._connection.execute(
                "SELECT COUNT(*) AS total FROM battle_events"
                + filter_where.replace("?", self._placeholder),
                filter_params,
            ).fetchone()
            rows = self._connection.execute(
                "SELECT * FROM battle_events"
                + page_where.replace("?", self._placeholder)
                + " ORDER BY sequence LIMIT "
                + self._placeholder,
                [*page_params, limit + 1],
            ).fetchall()
        return [self._to_event(row) for row in rows], int(total_row["total"])

    def list_events_for_battles(
        self, battle_ids: list[str]
    ) -> dict[str, list[dict[str, Any]]]:
        """Load event histories for a bounded set of battles in one query."""
        if not battle_ids:
            return {}
        placeholders = ", ".join([self._placeholder] * len(battle_ids))
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM battle_events WHERE battle_id IN ("
                + placeholders
                + ") ORDER BY battle_id, sequence",
                battle_ids,
            ).fetchall()
        grouped: dict[str, list[dict[str, Any]]] = {
            battle_id: [] for battle_id in battle_ids
        }
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
            self._connection.execute(
                "DELETE FROM audit_events WHERE battle_id = " + self._placeholder,
                (battle_id,),
            )
            self._connection.execute(
                "DELETE FROM battle_idempotency WHERE battle_id = " + self._placeholder,
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
            clauses.append("(topic LIKE ? OR id LIKE ? OR code LIKE ?)")
            pattern = f"%{query}%"
            params.extend([pattern, pattern, pattern])
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
            row = self._connection.execute(
                "SELECT COUNT(*) AS total FROM battle_events"
            ).fetchone()
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
            "attackGenerated": 0,
            "defenderDetected": 0,
            "fixesSuggested": 0,
            "strategyChecks": 0,
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
            elif (
                dispatch_mode == "local"
                and event["event_type"] == "agent.call.completed"
            ):
                summary["localRuleExecutionCount"] += 1
            latency = data.get("durationMs")
            if isinstance(latency, int) and latency >= 0:
                call_latencies.append(latency)
        if call_latencies:
            summary["averageAgentCallLatencyMs"] = round(
                sum(call_latencies) / len(call_latencies)
            )
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
            summary["attackGenerated"] += len(samples)
            summary["simulationSampleCount"] += sum(
                sample.get("simulation") is True for sample in samples
            )
            summary["ruleHitCount"] += sum(
                len(defense.get("caught", [])) for defense in defenses
            )
            summary["defenderDetected"] += sum(
                len(defense.get("caught", [])) for defense in defenses
            )
            summary["riskCount"] += sum(
                len(defense.get("risks", [])) for defense in defenses
            )
            summary["recommendationCount"] += sum(
                len(defense.get("fixed", [])) for defense in defenses
            )
            summary["fixesSuggested"] += sum(
                len(defense.get("fixed", [])) for defense in defenses
            )
            # TODO 战略检测口径：当前以 round.completed 事件数量作为策略检测次数。
            if (
                attacker_out.get("agentSource") == "acp"
                or str(attacker_out.get("agentSource", "")).startswith("acp-")
                or any(
                    defense.get("agentSource") == "acp"
                    or str(defense.get("agentSource", "")).startswith("acp-")
                    for defense in defenses
                )
            ):
                summary["acpCallBattles"] += 1
        with self._lock:
            round_row = self._connection.execute(
                "SELECT COUNT(*) AS total FROM battle_events WHERE event_type = "
                + self._placeholder,
                ("round.completed",),
            ).fetchone()
        summary["strategyChecks"] = int(round_row["total"])
        return summary

    def close(self) -> None:
        # Serialize shutdown with every store operation. Background workers run
        # queries through asyncio.to_thread(); closing the SQLite connection
        # while one of them is mid-execute causes a native access violation on
        # Windows, which no Python-level guard can catch. Holding the same lock
        # used by the operations guarantees we only close when the connection
        # is idle.
        with self._lock:
            if self._closed:
                return
            self._closed = True
            if self._pool is not None:
                self._pool.close()
                self._pool = None
            if self._engine is not None:
                self._engine.dispose()
                self._engine = None
            if not self._is_postgres and not self._is_mysql:
                self._connection.close()

    @staticmethod
    def _to_record(row: Any) -> dict[str, Any]:
        return {
            "id": row["id"],
            "code": row["code"] if "code" in row.keys() else None,  # noqa: SIM118 - SQLAlchemy Row compatibility.
            "difficulty": row["difficulty"],
            "topic": row["topic"],
            "status": row["status"],
            "rounds": row["rounds"] if "rounds" in row.keys() else 3,  # noqa: SIM118 - SQLAlchemy Row compatibility.
            "verdict": row["verdict"] if "verdict" in row.keys() else None,  # noqa: SIM118 - SQLAlchemy Row compatibility.
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
