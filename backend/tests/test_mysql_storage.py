from __future__ import annotations

from contextlib import contextmanager
from typing import Any

from agent_attack_lab.storage import BattleStore


class _Result:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self._rows = rows or []
        self.returns_rows = bool(rows)

    def mappings(self) -> _Result:
        return self

    def __iter__(self):
        return iter(self._rows)


class _Connection:
    def __init__(self, calls: list[tuple[str, Any]]) -> None:
        self._calls = calls

    def exec_driver_sql(self, statement: str, parameters: Any = ()) -> _Result:
        assert not isinstance(parameters, list)
        self._calls.append((statement, parameters))
        if statement.startswith("SHOW INDEX"):
            return _Result([])
        if "COUNT(*) AS total" in statement:
            return _Result([{"total": 0}])
        return _Result([])


class _Engine:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.disposed = False

    @contextmanager
    def begin(self):
        yield _Connection(self.calls)

    def dispose(self) -> None:
        self.disposed = True


def test_mysql_store_uses_mysql_pool_schema_and_queries(monkeypatch) -> None:
    import sqlalchemy

    engine = _Engine()
    engine_options: dict[str, Any] = {}

    def fake_create_engine(url, **kwargs):
        engine_options.update(url=url, **kwargs)
        return engine

    monkeypatch.setattr(sqlalchemy, "create_engine", fake_create_engine)
    monkeypatch.setenv("AGENT_DB_POOL_MAX_SIZE", "4")

    store = BattleStore("mysql://lab_user:test_password@db.example.test/attack_lab")
    assert store._is_mysql is True
    assert store._is_postgres is False
    assert store._placeholder == "%s"
    assert engine_options["url"].drivername == "mysql+pymysql"
    assert engine_options["url"].query["charset"] == "utf8mb4"
    assert engine_options["pool_size"] == 4
    assert engine_options["max_overflow"] == 0
    assert engine_options["pool_pre_ping"] is True

    statements = [statement for statement, _parameters in engine.calls]
    assert any("id VARCHAR(191) PRIMARY KEY" in statement for statement in statements)
    assert any("attacker_out LONGTEXT" in statement for statement in statements)
    assert (
        any("ON DUPLICATE KEY UPDATE" in statement for statement in statements) is False
    )

    store.save(
        {
            "id": "battle-1",
            "difficulty": "low",
            "topic": "登录安全",
            "status": "completed",
            "createdAt": "2026-10-08T00:00:00+00:00",
            "attackerOut": {"samples": []},
            "defenderOut": [],
        }
    )
    store.save_event(
        {
            "id": "event-1",
            "battleId": "battle-1",
            "sequence": 1,
            "type": "battle.completed",
            "status": "completed",
            "createdAt": "2026-10-08T00:00:00+00:00",
            "data": {},
        }
    )
    assert store.list(limit=10, offset=20) == []
    assert store.list_outputs(limit=10) == []
    assert store.get("battle-1") is None
    assert store.count(query="登录") == 0
    store.delete("battle-1")

    statements = [statement for statement, _parameters in engine.calls]
    assert sum("ON DUPLICATE KEY UPDATE" in statement for statement in statements) == 2
    assert any(
        "ORDER BY created_at DESC LIMIT %s OFFSET %s" in statement
        for statement in statements
    )
    assert any("WHERE id = %s" in statement for statement in statements)
    assert any(
        "SELECT attacker_out, defender_out FROM battles "
        "ORDER BY created_at DESC LIMIT %s OFFSET 0" == statement
        for statement in statements
    )
    assert any(
        "DELETE FROM battle_events WHERE battle_id = %s" in statement
        for statement in statements
    )
    assert any(
        "DELETE FROM battles WHERE id = %s" in statement for statement in statements
    )
    store.close()
    assert engine.disposed is True


def test_mysql_admin_rule_sql_quotes_reserved_words(monkeypatch) -> None:
    """condition/action 是 MySQL 保留字，三处 SQL 都必须反引号转义。

    这是生产事故的回归点：规则库列表在无搜索词时不碰这两列，所以“页面能打开”，
    但 INSERT/UPDATE 一直语法报错，规则写不进去、自动示例库也就补不上。
    """
    import sqlalchemy

    engine = _Engine()
    monkeypatch.setattr(sqlalchemy, "create_engine", lambda url, **kwargs: engine)

    store = BattleStore("mysql://lab_user:test_password@db.example.test/attack_lab")
    store.save_admin_rule(
        {"name": "保留字", "condition": "ignore previous", "action": "拦截"}
    )
    store.list_admin_rules("保留字")
    store.update_admin_rule("rule-1", {"condition": "x", "action": "放行"})

    statements = [statement for statement, _parameters in engine.calls]
    insert = next(s for s in statements if "INSERT INTO admin_rules" in s)
    assert "`condition`" in insert
    assert "`action`" in insert
    assert "name, condition" not in insert

    search = next(s for s in statements if "FROM admin_rules" in s and "LIKE" in s)
    assert "`condition` LIKE" in search

    update = next(s for s in statements if s.startswith("UPDATE admin_rules"))
    assert "`condition` = %s" in update
    assert "`action` = %s" in update

    create = next(
        s for s in statements if "CREATE TABLE IF NOT EXISTS admin_rules" in s
    )
    assert "`condition` TEXT NOT NULL" in create
    assert "`action` TEXT NOT NULL" in create
