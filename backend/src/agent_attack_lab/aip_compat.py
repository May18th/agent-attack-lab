"""Compatibility checks for ACP SDK server-side identity binding."""

from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import Any


_SERVER_IDENTITY_OPTIONS = {"local_aic", "identity_binding_enabled"}


def supports_server_identity_binding(handler: Callable[..., Any]) -> bool:
    """Return whether an SDK RPC handler accepts the identity-binding options."""
    parameters = inspect.signature(handler).parameters
    if any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD
        for parameter in parameters.values()
    ):
        return True
    return _SERVER_IDENTITY_OPTIONS.issubset(parameters)


def server_identity_options(
    handler: Callable[..., Any],
    *,
    local_aic: str | None,
    enabled: bool,
    setting_name: str,
) -> dict[str, Any]:
    """Build supported server options and reject silently ignored enforcement."""
    if enabled and not supports_server_identity_binding(handler):
        raise RuntimeError(
            f"{setting_name} 已开启，但当前 acps-sdk 不支持服务端身份绑定参数；"
            "请安装并验收匹配的官方 SDK，不能把该配置视为已生效"
        )

    options: dict[str, Any] = {
        "local_aic": local_aic,
        "identity_binding_enabled": enabled,
    }
    if supports_server_identity_binding(handler):
        return options

    parameters = inspect.signature(handler).parameters
    return {key: value for key, value in options.items() if key in parameters}
