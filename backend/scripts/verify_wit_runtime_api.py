"""Verify the private Wutong wheel API before attempting registration or serving."""

from __future__ import annotations

import importlib.metadata
import inspect


EXPECTED = {
    "acps-sdk": "2.2.0",
    "wit-framework": "2.1.0",
}


def main() -> int:
    for package, expected in EXPECTED.items():
        actual = importlib.metadata.version(package)
        if actual != expected:
            raise SystemExit(f"{package}={actual}; expected {expected}")

    import wit

    required_exports = (
        "AcpsConfig",
        "AcpsDirect",
        "AcpsRegistration",
        "AgentCertificateRequest",
        "AgentProviderProfile",
        "RegistryPasswordCredentials",
        "WitAgent",
        "WitRuntime",
        "capability",
    )
    missing_exports = [name for name in required_exports if not hasattr(wit, name)]
    if missing_exports:
        raise SystemExit(f"wit 缺少必要 API：{', '.join(missing_exports)}")

    runtime_methods = (
        "save_acs",
        "acs_draft",
        "login",
        "enroll",
        "up",
        "up_until_ready",
        "serve",
        "serve_direct_partner",
        "serve_group",
        "stop_serving",
    )
    missing_methods = [
        name for name in runtime_methods if not hasattr(wit.WitRuntime, name)
    ]
    if missing_methods:
        raise SystemExit(f"WitRuntime 缺少必要 API：{', '.join(missing_methods)}")

    async_methods = [
        name
        for name in (
            "login",
            "enroll",
            "up",
            "up_until_ready",
            "serve",
            "serve_direct_partner",
            "serve_group",
            "stop_serving",
        )
        if not inspect.iscoroutinefunction(getattr(wit.WitRuntime, name))
    ]
    if async_methods:
        raise SystemExit(f"WitRuntime 方法不是协程：{', '.join(async_methods)}")

    if not hasattr(wit.AcpsRegistration, "integrated") or not hasattr(
        wit.AcpsRegistration, "ontology"
    ) or not hasattr(wit.AcpsRegistration, "entity"):
        raise SystemExit("AcpsRegistration 缺少 integrated/ontology/entity 形态")
    if not hasattr(wit.RegistryPasswordCredentials, "from_env"):
        raise SystemExit("RegistryPasswordCredentials 缺少 from_env")

    print("wit-framework=2.1.0")
    print("acps-sdk=2.2.0")
    print("WitRuntime Identity/Direct/Group API 预检通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
