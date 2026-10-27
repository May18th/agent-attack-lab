import json
from contextlib import contextmanager
from threading import Lock

import pytest

from agent_attack_lab.storage import (
    BattleStore,
    _PooledConnection,
    _SqlAlchemyConnection,
)


def test_list_outputs_caps_at_100000_and_preserves_tied_time_order() -> None:
    store = BattleStore(":memory:")
    try:
        with store._lock:
            store._connection.executemany(
                "INSERT INTO battles "
                "(id, difficulty, topic, status, created_at, attacker_out, defender_out) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    (
                        f"boundary-{index}",
                        "low",
                        "边界测试",
                        "completed",
                        "2026-10-26" if index == 0 else "2026-10-27",
                        json.dumps({"samples": [{"index": index}]}),
                        "[]",
                    )
                    for index in range(100001)
                ),
            )
            store._connection.commit()

        outputs = store.list_outputs()
        assert len(outputs) == 100000
        assert all(item["attackerOut"]["samples"][0]["index"] != 0 for item in outputs)
        # Keep SQLite's existing tie order without imposing a new tie breaker.
        expected = [
            {"attackerOut": row["attackerOut"], "defenderOut": row["defenderOut"]}
            for row in store.list(limit=100000)
        ]
        assert outputs == expected
        assert store.list_outputs(limit=17) == expected[:17]
    finally:
        store.close()


class _DriverResult:
    def __init__(self, cursor):
        self.description = cursor.description
        self.returns_rows = self.description is not None
        self.rows = [dict(row) for row in cursor.fetchall()]

    def fetchall(self):
        return self.rows

    def mappings(self):
        return self.rows


class _SqliteBackedDriver:
    """Execute adapter queries locally; this is not a real remote DB test."""

    def __init__(self, connection):
        self.raw = connection
        self.calls = []
        self.commits = 0

    def execute(self, statement, parameters=()):
        assert "?" not in statement
        assert isinstance(parameters, tuple)
        self.calls.append((statement, parameters))
        return _DriverResult(self.raw.execute(statement.replace("%s", "?"), parameters))

    exec_driver_sql = execute

    def commit(self):
        self.commits += 1
        self.raw.commit()

    @contextmanager
    def connection(self):
        yield self

    @contextmanager
    def begin(self):
        yield self


@pytest.mark.parametrize("adapter", [_PooledConnection, _SqlAlchemyConnection])
def test_list_outputs_decodes_nonempty_rows_through_database_adapters(adapter) -> None:
    source = BattleStore(":memory:")
    try:
        attacker = {"samples": [{"severity": "high", "content": "中文样本"}]}
        defender = [{"caught": ["rule"], "fixed": ["修复建议"]}]
        source.save(
            {
                "id": "adapter-battle",
                "difficulty": "mid",
                "topic": "适配测试",
                "status": "completed",
                "createdAt": "2026-10-27",
                "attackerOut": attacker,
                "defenderOut": defender,
            }
        )
        driver = _SqliteBackedDriver(source._connection)
        store = object.__new__(BattleStore)
        store._lock = Lock()
        store._placeholder = "%s"
        store._connection = adapter(driver)

        assert store.list_outputs(limit=2) == [
            {"attackerOut": attacker, "defenderOut": defender}
        ]
        assert driver.calls == [
            (
                (
                    "SELECT attacker_out, defender_out FROM battles "
                    "ORDER BY created_at DESC LIMIT %s OFFSET 0"
                ),
                (2,),
            )
        ]
        if adapter is _PooledConnection:
            assert driver.commits == 1
    finally:
        source.close()
