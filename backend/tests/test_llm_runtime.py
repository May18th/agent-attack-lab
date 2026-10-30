from __future__ import annotations

import asyncio
import json

from agent_attack_lab.agents import llm_runtime


def test_complete_json_uses_deepseek_json_object_format(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"choices": [{"message": {"content": '{"samples": []}'}}]}

    class FakeClient:
        def __init__(self, *, timeout, trust_env) -> None:
            captured["timeout"] = timeout
            captured["trust_env"] = trust_env

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args) -> None:
            return None

        async def post(self, url, *, headers, json):
            captured.update(url=url, headers=headers, body=json)
            return FakeResponse()

    monkeypatch.setenv("AGENT_LLM_BASE_URL", "https://api.deepseek.com/v1")
    monkeypatch.setenv("AGENT_LLM_API_KEY", "test-key-not-a-real-secret")
    monkeypatch.setenv("AGENT_LLM_MODEL", "deepseek-chat")
    monkeypatch.setattr(llm_runtime.httpx, "AsyncClient", FakeClient)

    result = asyncio.run(llm_runtime.complete_json("Return JSON.", {"topic": "test"}))

    assert result == {"samples": []}
    assert captured["url"] == "https://api.deepseek.com/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer test-key-not-a-real-secret"
    assert captured["body"]["response_format"] == {"type": "json_object"}
    assert "json_schema" not in captured["body"]["response_format"]
    assert captured["body"]["model"] == "deepseek-chat"
    assert json.loads(captured["body"]["messages"][1]["content"]) == {"topic": "test"}


def test_arbiter_can_use_role_specific_chat_completions_configuration(
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"choices": [{"message": {"content": '{"verdict":"undetermined"}'}}]}

    class FakeClient:
        def __init__(self, *, timeout, trust_env) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args) -> None:
            return None

        async def post(self, url, *, headers, json):
            captured.update(url=url, headers=headers, body=json)
            return FakeResponse()

    monkeypatch.delenv("AGENT_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("AGENT_LLM_API_KEY", raising=False)
    monkeypatch.delenv("AGENT_LLM_MODEL", raising=False)
    monkeypatch.setenv("AGENT_ARBITER_LLM_BASE_URL", "https://arbiter.example/v1")
    monkeypatch.setenv("AGENT_ARBITER_LLM_API_KEY", "arbiter-key")
    monkeypatch.setenv("AGENT_ARBITER_LLM_MODEL", "arbiter-model")
    monkeypatch.setattr(llm_runtime.httpx, "AsyncClient", FakeClient)

    result = asyncio.run(llm_runtime.complete_json("Review.", {}, role="arbiter"))

    assert result == {"verdict": "undetermined"}
    assert captured["url"] == "https://arbiter.example/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer arbiter-key"
    assert captured["body"]["model"] == "arbiter-model"


def test_partial_role_configuration_falls_back_to_shared_endpoint(monkeypatch) -> None:
    """半配的角色块只能退回共享端点，不能把共享端点一起废掉。

    旧行为是"任一角色变量有值就切到角色前缀，再要求三项全有"，于是只填
    AGENT_ATTACKER_LLM_BASE_URL 会让攻击方判定为未配置，静默降级到本地规则，
    而共享端点明明可用。现在半配一律回落，并留一条 warning。
    """
    llm_runtime._WARNED_PARTIAL.clear()
    for name in ("BASE_URL", "API_KEY", "MODEL"):
        monkeypatch.delenv(f"AGENT_ATTACKER_LLM_{name}", raising=False)
    monkeypatch.setenv("AGENT_ATTACKER_LLM_BASE_URL", "https://attacker.example/v1")
    monkeypatch.setenv("AGENT_LLM_BASE_URL", "https://shared.example/v1")
    monkeypatch.setenv("AGENT_LLM_API_KEY", "shared-key")
    monkeypatch.setenv("AGENT_LLM_MODEL", "shared-model")

    assert llm_runtime._selected_prefix("attacker") == "AGENT_LLM_"
    assert llm_runtime.is_configured(role="attacker") is True
    assert llm_runtime.is_configured() is True


def test_partial_role_configuration_without_shared_endpoint_stays_unconfigured(
    monkeypatch,
) -> None:
    llm_runtime._WARNED_PARTIAL.clear()
    for name in ("BASE_URL", "API_KEY", "MODEL"):
        monkeypatch.delenv(f"AGENT_ATTACKER_LLM_{name}", raising=False)
        monkeypatch.delenv(f"AGENT_LLM_{name}", raising=False)
    monkeypatch.setenv("AGENT_ATTACKER_LLM_MODEL", "attacker-model")

    assert llm_runtime._selected_prefix("attacker") == "AGENT_LLM_"
    assert llm_runtime.is_configured(role="attacker") is False


def test_complete_role_configuration_takes_precedence_over_shared(monkeypatch) -> None:
    llm_runtime._WARNED_PARTIAL.clear()
    monkeypatch.setenv("AGENT_LLM_BASE_URL", "https://shared.example/v1")
    monkeypatch.setenv("AGENT_LLM_API_KEY", "shared-key")
    monkeypatch.setenv("AGENT_LLM_MODEL", "shared-model")
    monkeypatch.setenv("AGENT_DEFENDER_LLM_BASE_URL", "https://defender.example/v1")
    monkeypatch.setenv("AGENT_DEFENDER_LLM_API_KEY", "defender-key")
    monkeypatch.setenv("AGENT_DEFENDER_LLM_MODEL", "defender-model")

    assert llm_runtime._selected_prefix("defender") == "AGENT_DEFENDER_LLM_"


def test_unknown_model_role_is_rejected() -> None:
    try:
        llm_runtime.is_configured(role="unknown")
    except llm_runtime.LLMError as exc:
        assert str(exc) == "invalid model role"
    else:
        raise AssertionError("unknown model roles must be rejected")
