from __future__ import annotations

import pytest

from agent_attack_lab.aip_compat import (
    server_identity_options,
    supports_server_identity_binding,
)


def legacy_handler(request, handlers):
    return request, handlers


def modern_handler(
    request,
    handlers,
    local_aic=None,
    identity_binding_enabled=False,
):
    return request, handlers, local_aic, identity_binding_enabled


def extensible_handler(request, handlers, **kwargs):
    return request, handlers, kwargs


@pytest.mark.parametrize("handler", [modern_handler, extensible_handler])
def test_supported_server_identity_binding_options_are_preserved(handler) -> None:
    assert supports_server_identity_binding(handler)
    assert server_identity_options(
        handler,
        local_aic="1.2.156.3088.1.test",
        enabled=True,
        setting_name="AGENT_PARTNER_IDENTITY_BINDING_ENABLED",
    ) == {
        "local_aic": "1.2.156.3088.1.test",
        "identity_binding_enabled": True,
    }


def test_disabled_identity_binding_keeps_legacy_sdk_compatible() -> None:
    assert not supports_server_identity_binding(legacy_handler)
    assert server_identity_options(
        legacy_handler,
        local_aic=None,
        enabled=False,
        setting_name="AGENT_IDENTITY_BINDING_ENABLED",
    ) == {}


@pytest.mark.parametrize(
    "setting_name",
    ["AGENT_IDENTITY_BINDING_ENABLED", "AGENT_PARTNER_IDENTITY_BINDING_ENABLED"],
)
def test_enabled_identity_binding_rejects_unsupported_sdk(setting_name: str) -> None:
    with pytest.raises(RuntimeError, match="当前 acps-sdk 不支持服务端身份绑定参数"):
        server_identity_options(
            legacy_handler,
            local_aic="1.2.156.3088.1.test",
            enabled=True,
            setting_name=setting_name,
        )
