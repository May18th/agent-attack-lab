"""AMP 心跳上报：让本机 Agent 在梧桐平台显示为"在线"。

背景（2026-10-25 实测结论）
--------------------------
梧桐 Discovery v2.2 的缺省过滤除了 ``active=true`` + ``visibility=public``，
还叠加了 ``extFilter`` 的 ``alive=["online"]``。存活状态不来自 ACS 声明，而是
来自 AMP heartbeat 链路：

    进程周期写 amp.heartbeat 记录 → 平台 Kafka(amp.heartbeat) → alive-sync 入库

没上报过心跳的 Agent 存活状态是 ``unknown``（"从未被观测到"），于是按 AIC
精确查、按名称查、首页「输入 AIC 查询在线状态」都查不到；``/discovery/admin/
alive-sync/status`` 里的 ``aliveCount`` 也不会算它。

本模块做两件事
--------------
1. 按 ACPs AMP 规范（schema 1.0）生成 heartbeat 记录，追加到本地 NDJSON
   （``amp_heartbeat_<role>.jsonl``）——与官方 Fluent Bit 方案完全兼容；
2. 可选地把同一条记录直接投递到平台 Kafka，Windows 开发机无需安装 Fluent Bit。

设计约束
--------
- 默认关闭（``AGENT_AMP_ENABLED=0``）：不配置就完全不影响现有运行方式。
- 任何环节失败只记 warning，绝不抛给业务路径；Kafka 连不上时仍然写 NDJSON。
- 未安装 ``kafka-python`` 时退化为"只写文件"，由运维用 Fluent Bit 转发。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("agent_attack_lab.amp")

DEFAULT_BROKERS = "wt.ioa.pub:19092"
DEFAULT_TOPIC = "amp.heartbeat"
DEFAULT_INTERVAL_SECONDS = 15.0
SCHEMA_VERSION = "1.0"

# 平台侧三只智能体的公开身份（AIC 公开可见，不属凭据）。允许被环境变量覆盖。
_IDENTITIES_FILENAME = "agent-identities.json"


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def enabled() -> bool:
    """心跳是否开启；默认关闭，避免未配置的环境去连平台 Kafka。"""
    return _flag("AGENT_AMP_ENABLED", False)


def _identity_file() -> Path:
    override = _env("AGENT_AMP_IDENTITIES_FILE")
    if override:
        return Path(override).expanduser()
    return Path(__file__).resolve().parents[2] / _IDENTITIES_FILENAME


def load_identities(path: Path | None = None) -> dict[str, str]:
    """读取 role → AIC 映射；文件缺失或损坏时返回空表，不抛异常。"""
    target = path or _identity_file()
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.warning("AMP 身份文件不存在：%s", target)
        return {}
    except (OSError, ValueError) as exc:
        logger.warning("AMP 身份文件读取失败：%s (%s)", target, exc)
        return {}
    mapping: dict[str, str] = {}
    for role, entry in raw.items():
        if role.startswith("_"):
            continue  # 允许 `_comment` 之类的说明字段
        if isinstance(entry, str):
            mapping[role] = entry.strip()
        elif isinstance(entry, dict):
            aic = str(entry.get("aic", "")).strip()
            if aic:
                mapping[role] = aic
    return {role: aic for role, aic in mapping.items() if aic}


@dataclass(frozen=True)
class AmpIdentity:
    role: str
    aic: str


def resolve_identity() -> AmpIdentity | None:
    """按 AGENT_AMP_AIC → AGENT_AMP_ROLE → AGENT_LOCAL_AIC 的顺序解析身份。"""
    role = _env("AGENT_AMP_ROLE") or "agent"
    explicit = _env("AGENT_AMP_AIC")
    if explicit:
        return AmpIdentity(role=role, aic=explicit)
    mapped = load_identities().get(role)
    if mapped:
        return AmpIdentity(role=role, aic=mapped)
    local = _env("AGENT_LOCAL_AIC")
    if local:
        return AmpIdentity(role=role, aic=local)
    return None


def heartbeat_record(
    aic: str,
    *,
    uptime_seconds: float = 0.0,
    log_id: str | None = None,
    timestamp: str | None = None,
) -> dict[str, Any]:
    """构造 AMP heartbeat 记录（字段与 acps-sdk HeartbeatEmitter 逐字节一致）。"""
    return {
        "schema_version": SCHEMA_VERSION,
        "log_id": log_id or str(uuid.uuid4()),
        "log_type": "heartbeat",
        "timestamp": timestamp or datetime.now(UTC).isoformat(),
        "aic": aic,
        "body": {"uptimeSeconds": round(uptime_seconds, 3)},
    }


class AmpHeartbeat:
    """周期性上报心跳；进程存活期间一直运行。"""

    def __init__(
        self,
        identity: AmpIdentity,
        *,
        brokers: str = DEFAULT_BROKERS,
        topic: str = DEFAULT_TOPIC,
        interval_seconds: float = DEFAULT_INTERVAL_SECONDS,
        log_dir: Path | None = None,
        write_ndjson: bool = True,
    ) -> None:
        self.identity = identity
        self.brokers = [item.strip() for item in brokers.split(",") if item.strip()]
        self.topic = topic
        self.interval_seconds = max(1.0, float(interval_seconds))
        self.log_dir = log_dir or Path(_env("AGENT_AMP_LOG_DIR") or ".data/amp")
        self.write_ndjson = write_ndjson
        self._producer: Any = None
        self._producer_failed = False
        self._task: asyncio.Task[None] | None = None
        self._started_monotonic = time.monotonic()
        self._sent = 0
        self._send_failures = 0

    # --- 生命周期 ---------------------------------------------------------

    @classmethod
    def from_env(cls) -> AmpHeartbeat | None:
        """按环境变量装配；未开启或无可用身份时返回 None。"""
        if not enabled():
            return None
        identity = resolve_identity()
        if identity is None:
            logger.warning(
                "AGENT_AMP_ENABLED 已开启，但未解析到 AIC（设置 AGENT_AMP_AIC、"
                "AGENT_AMP_ROLE 或 AGENT_LOCAL_AIC）"
            )
            return None
        return cls(
            identity,
            brokers=_env("AGENT_AMP_KAFKA_BROKERS") or DEFAULT_BROKERS,
            topic=_env("AGENT_AMP_TOPIC") or DEFAULT_TOPIC,
            interval_seconds=float(
                _env("AGENT_AMP_INTERVAL_SECONDS") or DEFAULT_INTERVAL_SECONDS
            ),
            write_ndjson=_flag("AGENT_AMP_NDJSON", True),
        )

    async def start(self) -> None:
        if self._task is not None:
            return
        logger.info(
            "AMP 心跳启动：role=%s aic=%s 间隔=%.0fs brokers=%s topic=%s",
            self.identity.role,
            self.identity.aic,
            self.interval_seconds,
            ",".join(self.brokers),
            self.topic,
        )
        self._task = asyncio.create_task(self._run(), name="amp-heartbeat")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        if self._producer is not None:
            producer, self._producer = self._producer, None
            with contextlib.suppress(Exception):
                await asyncio.to_thread(producer.close, 5)

    # --- 内部 -------------------------------------------------------------

    async def _run(self) -> None:
        while True:
            try:
                await self.emit_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # 心跳失败不能影响业务
                logger.warning("AMP 心跳单次失败", exc_info=True)
            await asyncio.sleep(self.interval_seconds)

    async def emit_once(self) -> dict[str, Any]:
        record = heartbeat_record(
            self.identity.aic,
            uptime_seconds=time.monotonic() - self._started_monotonic,
        )
        if self.write_ndjson:
            await asyncio.to_thread(self._append_ndjson, record)
        await asyncio.to_thread(self._publish, record)
        return record

    def _ndjson_path(self) -> Path:
        return self.log_dir / f"amp_heartbeat_{self.identity.role}.jsonl"

    def _append_ndjson(self, record: dict[str, Any]) -> None:
        try:
            path = self._ndjson_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        except Exception:
            logger.warning("AMP 心跳写本地文件失败", exc_info=True)

    def _ensure_producer(self) -> Any:
        if self._producer is not None or self._producer_failed:
            return self._producer
        try:
            from kafka import KafkaProducer
        except Exception:  # noqa: BLE001 - 未安装客户端时退化为只写文件
            logger.warning(
                "未安装 kafka-python，AMP 心跳只写本地 NDJSON（需 Fluent Bit 转发）"
            )
            self._producer_failed = True
            return None
        try:
            self._producer = KafkaProducer(
                bootstrap_servers=self.brokers,
                value_serializer=lambda value: json.dumps(
                    value, ensure_ascii=False
                ).encode("utf-8"),
                request_timeout_ms=8000,
                retries=1,
                acks=1,
            )
        except Exception:
            if self._send_failures == 0:
                logger.warning("AMP Kafka 连接失败，稍后重试", exc_info=True)
            self._producer_failed = True
        return self._producer

    def _publish(self, record: dict[str, Any]) -> None:
        producer = self._ensure_producer()
        if producer is None:
            return
        try:
            future = producer.send(self.topic, value=record)
            future.get(timeout=10)
            self._sent += 1
            self._send_failures = 0
        except Exception:
            self._send_failures += 1
            # 重试前先放弃旧连接，避免一直复用坏连接
            with contextlib.suppress(Exception):
                producer.close(1)
            self._producer = None
            self._producer_failed = False
            if self._send_failures in {1, 5, 20} or self._send_failures % 60 == 0:
                logger.warning(
                    "AMP 心跳投递失败（累计 %d 次）", self._send_failures, exc_info=True
                )

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "role": self.identity.role,
            "aic": self.identity.aic,
            "sent": self._sent,
            "failures": self._send_failures,
            "intervalSeconds": self.interval_seconds,
            "topic": self.topic,
            "brokers": self.brokers,
        }


_ACTIVE: AmpHeartbeat | None = None


async def start_from_env() -> AmpHeartbeat | None:
    """进程启动时调用；返回已启动的实例或 None。重复调用无副作用。"""
    global _ACTIVE
    if _ACTIVE is not None:
        return _ACTIVE
    heartbeat = AmpHeartbeat.from_env()
    if heartbeat is None:
        return None
    await heartbeat.start()
    _ACTIVE = heartbeat
    return _ACTIVE


async def stop_active() -> None:
    global _ACTIVE
    heartbeat, _ACTIVE = _ACTIVE, None
    if heartbeat is not None:
        await heartbeat.stop()


def active_stats() -> dict[str, Any] | None:
    return _ACTIVE.stats if _ACTIVE is not None else None
