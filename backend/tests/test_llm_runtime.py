from __future__ import annotations

import asyncio
import json

import agent_attack_lab.agents.llm_runtime as llm_runtime


def test_complete_json_uses_common_openai_json_object_format(monkeypatch) -> None:
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

    monkeypatch.setenv("AGENT_LLM_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("AGENT_LLM_API_KEY", "test-key-not-a-real-secret")
    monkeypatch.setenv("AGENT_LLM_MODEL", "deepseek-flash")
    monkeypatch.setattr(llm_runtime.httpx, "AsyncClient", FakeClient)

    result = asyncio.run(llm_runtime.complete_json("Return JSON.", {"topic": "test"}))

    assert result == {"samples": []}
    assert captured["url"] == "https://api.deepseek.com/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer test-key-not-a-real-secret"
    assert captured["body"]["response_format"] == {"type": "json_object"}
    assert "json_schema" not in captured["body"]["response_format"]
    assert captured["body"]["model"] == "deepseek-flash"
    assert json.loads(captured["body"]["messages"][1]["content"]) == {"topic": "test"}
