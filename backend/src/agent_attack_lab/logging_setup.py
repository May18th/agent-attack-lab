"""应用日志初始化。

uvicorn 的 ``--log-level`` 只作用于它自己的 ``uvicorn`` / ``uvicorn.error`` /
``uvicorn.access`` 三个 logger，不会改变根 logger 的级别，也不会给根 logger
装 handler。api 进程此前只在 ``service.py`` 里取了 ``logging.getLogger``，
既没设级别也没装 handler，因此 ``agent_attack_lab.llm`` 的 INFO 记录
（``model_call_completed`` / ``model_text_completed``）在生产被静默丢弃，
而 attacker / defender 两个服务因为导入 ``agents.common`` 触发了
``logging.basicConfig`` 才有日志。

这里统一做两件事，避免再依赖某个模块的导入副作用：

1. 根 logger 没有 handler 时装一个，保证记录真的能落盘；
2. 把 ``agent_attack_lab`` 包 logger 调到 INFO，且不抬高已经更低的级别。

只调包 logger 而不动根 logger 的级别，是为了让 httpx、openai 这类依赖的
INFO 噪音维持原样。
"""

from __future__ import annotations

import logging

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"

_PACKAGE_LOGGER = "agent_attack_lab"


def configure_logging(level: int = logging.INFO) -> None:
    """确保应用日志可观测：根 logger 有 handler，包 logger 至少到 ``level``。"""
    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(LOG_FORMAT))
        root.addHandler(handler)

    package = logging.getLogger(_PACKAGE_LOGGER)
    if package.level == logging.NOTSET or package.level > level:
        package.setLevel(level)
