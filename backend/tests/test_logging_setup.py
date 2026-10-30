"""应用日志初始化的回归测试。

背景：生产 api 进程只取了 ``logging.getLogger("agent_attack_lab")``，既没设
级别也没装 handler，导致 ``agent_attack_lab.llm`` 的 INFO 记录全部被根 logger
的默认 WARNING 拦截，``journalctl`` 里看不到任何 ``model_call_completed``。
attacker / defender 恰好因为导入 ``agents.common`` 触发了 ``basicConfig`` 才有
日志，于是同一套代码出现"两个服务有日志、一个服务没有"的假象。
"""

from __future__ import annotations

import logging
from pathlib import Path

import agent_attack_lab.service as service_module
from agent_attack_lab.logging_setup import configure_logging


def test_configure_logging_raises_package_logger_to_info() -> None:
    package = logging.getLogger("agent_attack_lab")
    original = package.level
    package.setLevel(logging.WARNING)
    try:
        assert (
            logging.getLogger("agent_attack_lab.llm").isEnabledFor(logging.INFO)
            is False
        )

        configure_logging()

        assert (
            logging.getLogger("agent_attack_lab.llm").isEnabledFor(logging.INFO) is True
        )
    finally:
        package.setLevel(original)


def test_configure_logging_keeps_an_already_lower_level() -> None:
    package = logging.getLogger("agent_attack_lab")
    original = package.level
    package.setLevel(logging.DEBUG)
    try:
        configure_logging()

        assert package.level == logging.DEBUG
    finally:
        package.setLevel(original)


def test_configure_logging_installs_root_handler_when_missing() -> None:
    root = logging.getLogger()
    saved = list(root.handlers)
    root.handlers.clear()
    try:
        configure_logging()

        assert root.handlers
        assert root.handlers[0].formatter is not None
    finally:
        root.handlers[:] = saved


def test_configure_logging_does_not_change_root_level() -> None:
    # 只调包 logger 的级别，避免把 httpx / openai 的 INFO 噪音一起放出来。
    root = logging.getLogger()
    original = root.level
    try:
        root.setLevel(logging.WARNING)
        configure_logging()

        assert root.level == logging.WARNING
    finally:
        root.setLevel(original)


def test_model_call_logs_are_emitted_after_configuration(caplog) -> None:
    package = logging.getLogger("agent_attack_lab")
    original = package.level
    package.setLevel(logging.WARNING)
    try:
        configure_logging()
        logging.getLogger("agent_attack_lab.llm").info(
            "model_call_completed role=attacker duration_ms=1 attempt=1"
        )

        assert any(
            "model_call_completed" in record.getMessage() for record in caplog.records
        )
    finally:
        package.setLevel(original)


def test_service_application_configures_logging_on_import() -> None:
    source = Path(service_module.__file__).read_text(encoding="utf-8")

    assert "configure_logging()" in source
    assert "logging.basicConfig(" not in source
