"""内置示例库与审计日志筛选的回归测试。

覆盖两个真实缺口：

1. ``admin_samples`` / ``admin_rules`` 建表后没有任何初始数据，样本库和规则库
   页面永远是空的；``POST /admin/library/seed`` 必须幂等补齐。
2. 审计筛选原先用 ``=`` 精确匹配 ``event_type`` / ``actor_role``，且直接拿
   ``datetime-local`` 的本地时间串和 UTC 存储值比大小，实际查不到东西。
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from agent_attack_lab import config, service
from agent_attack_lab.library_seed import (
    SEED_MARKER_KEY,
    SEED_RULES,
    SEED_SAMPLES,
    auto_seed,
)
from agent_attack_lab.service import app
from agent_attack_lab.storage import BattleStore

client = TestClient(app)


def _drop_seed_rows() -> None:
    """seed 行会写进进程内共享库，用完必须清掉，避免影响其它用例。"""
    for item in client.get("/admin/samples", params={"limit": 500}).json():
        if str(item["id"]).startswith("seed-"):
            client.delete(f"/admin/samples/{item['id']}")
    for item in client.get("/admin/rules", params={"limit": 500}).json():
        if str(item["id"]).startswith("seed-"):
            client.delete(f"/admin/rules/{item['id']}")


def test_seed_library_fills_empty_tables_and_is_idempotent() -> None:
    _drop_seed_rows()
    try:
        first = client.post("/admin/library/seed")
        assert first.status_code == 200
        body = first.json()
        assert body["samples"]["created"] == len(SEED_SAMPLES)
        assert body["rules"]["created"] == len(SEED_RULES)

        samples = client.get("/admin/samples", params={"limit": 500}).json()
        rules = client.get("/admin/rules", params={"limit": 500}).json()
        assert {item["id"] for item in samples} >= {item["id"] for item in SEED_SAMPLES}
        assert {item["id"] for item in rules} >= {item["id"] for item in SEED_RULES}
        # 主题必须能对上预置主题，否则 attacker knowledge 的 topic 匹配会落空。
        assert any("提示注入" in item["topic"] for item in samples)

        second = client.post("/admin/library/seed").json()
        assert second["samples"]["created"] == 0
        assert second["rules"]["created"] == 0
        assert second["samples"]["skipped"] == len(SEED_SAMPLES)
        assert second["rules"]["skipped"] == len(SEED_RULES)

        types = [
            row["eventType"]
            for row in client.get(
                "/admin/audit-logs", params={"operation": "admin.library.seeded"}
            ).json()
        ]
        assert "admin.library.seeded" in types
    finally:
        _drop_seed_rows()


def test_audit_filters_accept_partial_role_and_operation() -> None:
    created = client.post(
        "/admin/samples",
        json={"topic": "审计筛选测试", "content": "payload", "source": "测试"},
    ).json()
    try:
        # 全名能查、片段也能查：使用者不会去背 admin.sample.created。
        for operation in ("admin.sample.created", "admin.sample", "sample"):
            logs = client.get(
                "/admin/audit-logs", params={"operation": operation}
            ).json()
            assert any(row["eventType"] == "admin.sample.created" for row in logs), (
                operation
            )

        by_role = client.get("/admin/audit-logs", params={"user": "adm"}).json()
        assert by_role and all("adm" in (row["actorRole"] or "") for row in by_role)
    finally:
        client.delete(f"/admin/samples/{created['id']}")


def test_audit_time_bounds_use_utc_storage_format() -> None:
    created = client.post(
        "/admin/samples",
        json={"topic": "时间筛选测试", "content": "payload", "source": "测试"},
    ).json()
    try:
        now = datetime.now(UTC)
        # 前端传 Z 结尾的 ISO 串；存储值是 +00:00 带微秒的格式，必须归一化后可比。
        assert client.get(
            "/admin/audit-logs",
            params={
                "from_time": now.replace(microsecond=0)
                .isoformat()
                .replace("+00:00", "Z")
            },
        ).json()
        assert (
            client.get(
                "/admin/audit-logs",
                params={
                    "operation": "admin.sample.created",
                    "to_time": (now.replace(year=now.year - 1)).isoformat(),
                },
            ).json()
            == []
        )
        # 无时区的本地时间不应抛错（解析失败时退回原串比大小）。
        assert isinstance(
            client.get(
                "/admin/audit-logs", params={"from_time": "2026-01-01T00:00"}
            ).json(),
            list,
        )
    finally:
        client.delete(f"/admin/samples/{created['id']}")


def test_auto_seed_fills_empty_store_only_once() -> None:
    store = BattleStore(":memory:")
    try:
        first = auto_seed(store)
        assert first["status"] == "applied"
        assert len(store.list_admin_samples(limit=500)) == len(SEED_SAMPLES)
        assert len(store.list_admin_rules(limit=500)) == len(SEED_RULES)
        assert store.get_admin_library_meta(SEED_MARKER_KEY) == "applied"

        # 第二次启动不该重复写入，也不该覆盖被编辑过的条目
        store.update_admin_sample(SEED_SAMPLES[0]["id"], {"topic": "管理员改过的主题"})
        assert auto_seed(store)["status"] == "already_initialized"
        topics = [item["topic"] for item in store.list_admin_samples(limit=500)]
        assert "管理员改过的主题" in topics
        assert len(topics) == len(SEED_SAMPLES)
    finally:
        store.close()


def test_auto_seed_never_touches_hand_made_rows() -> None:
    store = BattleStore(":memory:")
    try:
        store.save_admin_sample(
            {"topic": "自建样本", "content": "payload", "source": "管理员"}
        )
        # 一条手建残留不该挡住整个库的补齐，但也不能被覆盖或删除
        assert auto_seed(store)["status"] == "applied"
        topics = [item["topic"] for item in store.list_admin_samples(limit=500)]
        assert "自建样本" in topics
        assert len(topics) == len(SEED_SAMPLES) + 1
        assert len(store.list_admin_rules(limit=500)) == len(SEED_RULES)

        # 标记落库后，管理员主动删空也不会在重启时被重新填满
        for item in store.list_admin_samples(limit=500):
            store.delete_admin_sample(item["id"])
        assert auto_seed(store)["status"] == "already_initialized"
        assert store.list_admin_samples(limit=500) == []

        # 运维需要重来时清掉标记即可，并且只会补回缺失项
        store.delete_admin_library_meta(SEED_MARKER_KEY)
        assert auto_seed(store)["status"] == "applied"
        assert len(store.list_admin_samples(limit=500)) == len(SEED_SAMPLES)
    finally:
        store.close()


def test_auto_seed_can_be_disabled_by_env() -> None:
    store = BattleStore(":memory:")
    try:
        assert auto_seed(store, enabled=False)["status"] == "disabled"
        assert store.list_admin_samples(limit=500) == []
        assert store.get_admin_library_meta(SEED_MARKER_KEY) is None
    finally:
        store.close()


def test_lifespan_bootstraps_libraries_with_configured_switch(monkeypatch) -> None:
    """接线检查：启动流程必须调用 auto_seed，并透传 config 的开关。"""
    calls: list[bool] = []

    def fake_auto_seed(_store, *, enabled: bool = True) -> dict[str, str]:
        calls.append(enabled)
        return {"status": "stubbed"}

    monkeypatch.setattr(service.library_seed, "auto_seed", fake_auto_seed)
    with TestClient(app):
        pass
    assert calls == [config.admin_library_autoseed]


def test_mysql_reserved_word_columns_are_quoted() -> None:
    """condition/action 是 MySQL 保留字：不转义时规则库在 MySQL 上完全写不进去。"""
    import pathlib

    import agent_attack_lab.storage as storage_module
    from agent_attack_lab.storage import _quote_identifier

    assert _quote_identifier("condition", is_postgres=False) == "`condition`"
    assert _quote_identifier("action", is_postgres=False) == "`action`"
    assert _quote_identifier("condition", is_postgres=True) == '"condition"'

    source = pathlib.Path(storage_module.__file__).read_text(encoding="utf-8")
    # MySQL 建表语句同样要转义，否则全新的库连 admin_rules 都建不出来
    assert "`condition` TEXT NOT NULL" in source
    assert "`action` TEXT NOT NULL" in source
    # 规则的 INSERT / WHERE / UPDATE 都要走方言引用，不能再出现裸列名
    assert 'self._col("condition")' in source
    assert "self._col(column)" in source
    assert "INSERT INTO admin_rules (id, name, condition" not in source
    assert "OR condition " not in source


def test_rule_crud_roundtrip_uses_quoted_columns() -> None:
    store = BattleStore(":memory:")
    try:
        rule = store.save_admin_rule(
            {"name": "保留字校验", "condition": "ignore previous", "action": "拦截"}
        )
        assert rule["action"] == "拦截"
        assert [item["name"] for item in store.list_admin_rules("保留字")] == [
            "保留字校验"
        ]
        updated = store.update_admin_rule(
            rule["id"], {"condition": "x", "action": "放行"}
        )
        assert updated is not None and updated["action"] == "放行"
    finally:
        store.close()
