"""AMP 心跳上报的离线契约测试（不访问平台 Kafka / Discovery）。"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from agent_attack_lab import amp

ATTACK_AIC = "1.2.156.3088.1.BUPT.RX2TMW.LMB4VK.NJ99P0.08RN"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for name in (
        "AGENT_AMP_ENABLED",
        "AGENT_AMP_AIC",
        "AGENT_AMP_ROLE",
        "AGENT_LOCAL_AIC",
        "AGENT_AMP_KAFKA_BROKERS",
        "AGENT_AMP_TOPIC",
        "AGENT_AMP_INTERVAL_SECONDS",
        "AGENT_AMP_LOG_DIR",
        "AGENT_AMP_NDJSON",
        "AGENT_AMP_IDENTITIES_FILE",
    ):
        monkeypatch.delenv(name, raising=False)
    yield
    amp._ACTIVE = None


def test_heartbeat_disabled_by_default():
    assert amp.enabled() is False
    assert amp.AmpHeartbeat.from_env() is None


def test_heartbeat_record_matches_amp_schema():
    record = amp.heartbeat_record(ATTACK_AIC, uptime_seconds=1.23456)

    # 字段集合与 acps-sdk HeartbeatEmitter 的输出保持一致，顺序无关但键名必须一致。
    assert list(record) == [
        "schema_version",
        "log_id",
        "log_type",
        "timestamp",
        "aic",
        "body",
    ]
    assert record["schema_version"] == "1.0"
    assert record["log_type"] == "heartbeat"
    assert record["aic"] == ATTACK_AIC
    assert record["body"] == {"uptimeSeconds": 1.235}
    assert record["timestamp"].endswith("+00:00")
    json.dumps(record, ensure_ascii=False)  # 必须可直接序列化


def test_identity_prefers_explicit_aic(monkeypatch):
    monkeypatch.setenv("AGENT_AMP_ENABLED", "1")
    monkeypatch.setenv("AGENT_AMP_ROLE", "defender")
    monkeypatch.setenv("AGENT_AMP_AIC", "explicit-aic")
    monkeypatch.setenv("AGENT_LOCAL_AIC", "local-aic")

    identity = amp.resolve_identity()

    assert identity is not None
    assert identity.aic == "explicit-aic"
    assert identity.role == "defender"


def test_identity_falls_back_to_local_aic(monkeypatch):
    monkeypatch.setenv("AGENT_AMP_ROLE", "unknown-role")
    monkeypatch.setenv("AGENT_LOCAL_AIC", "local-aic")

    identity = amp.resolve_identity()

    assert identity is not None
    assert identity.aic == "local-aic"


def test_identity_file_missing_is_not_fatal(monkeypatch, tmp_path):
    monkeypatch.setenv("AGENT_AMP_IDENTITIES_FILE", str(tmp_path / "nope.json"))

    assert amp.load_identities() == {}
    assert amp.resolve_identity() is None


def test_shipped_identity_file_has_three_roles():
    identities = amp.load_identities()

    assert set(identities) == {"leader", "attacker", "defender"}
    assert identities["attacker"] == ATTACK_AIC
    for aic in identities.values():
        assert aic.startswith("1.2.156.3088.1.BUPT.")


def test_emit_once_writes_ndjson_and_publishes(monkeypatch, tmp_path):
    published: list[dict] = []
    heartbeat = amp.AmpHeartbeat(
        amp.AmpIdentity(role="attacker", aic=ATTACK_AIC),
        log_dir=tmp_path,
    )
    monkeypatch.setattr(heartbeat, "_publish", published.append)

    record = asyncio.run(heartbeat.emit_once())

    lines = (
        (tmp_path / "amp_heartbeat_attacker.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    )
    assert len(lines) == 1
    assert json.loads(lines[0]) == record
    assert published == [record]
    assert record["aic"] == ATTACK_AIC


def test_publish_without_kafka_does_not_raise(tmp_path):
    heartbeat = amp.AmpHeartbeat(
        amp.AmpIdentity(role="attacker", aic=ATTACK_AIC),
        log_dir=tmp_path,
        write_ndjson=False,
    )
    # 模拟未安装 kafka-python（_ensure_producer 无法建连）的环境
    heartbeat._producer_failed = True
    heartbeat._producer = None

    heartbeat._publish(amp.heartbeat_record(ATTACK_AIC))  # 不抛异常


def test_start_from_env_is_noop_when_disabled(monkeypatch, tmp_path):
    monkeypatch.setenv("AGENT_AMP_LOG_DIR", str(tmp_path))

    assert asyncio.run(amp.start_from_env()) is None
    assert amp.active_stats() is None
    assert list(tmp_path.iterdir()) == []


def test_env_parsing_for_brokers_and_interval(monkeypatch):
    monkeypatch.setenv("AGENT_AMP_ENABLED", "1")
    monkeypatch.setenv("AGENT_AMP_AIC", ATTACK_AIC)
    monkeypatch.setenv("AGENT_AMP_KAFKA_BROKERS", "a:1, b:2")
    monkeypatch.setenv("AGENT_AMP_INTERVAL_SECONDS", "5")

    heartbeat = amp.AmpHeartbeat.from_env()

    assert heartbeat is not None
    assert heartbeat.brokers == ["a:1", "b:2"]
    assert heartbeat.interval_seconds == 5.0
    assert heartbeat.topic == amp.DEFAULT_TOPIC


def test_identities_file_is_valid_json_at_expected_path():
    path = Path(amp.__file__).resolve().parents[2] / "agent-identities.json"
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert "leader" in payload
