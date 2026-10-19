from __future__ import annotations

import asyncio
import json

import pytest
from acps_sdk.aip import Product, StructuredDataItem, TaskResult, TaskState, TaskStatus

import agent_attack_lab.acp_agents as acp_agents


class FakeAipClient:
    def __init__(self, result: TaskResult) -> None:
        self.result = result
        self.request: dict[str, str] = {}
        self.closed = False

    async def start_task(self, *, session_id: str, user_input: str) -> TaskResult:
        self.request = {"session_id": session_id, "user_input": user_input}
        return self.result

    async def close(self) -> None:
        self.closed = True


def task_result(data: dict[str, object]) -> TaskResult:
    return TaskResult(
        id="result-1",
        sentAt="2026-10-07T00:00:00+00:00",
        senderRole="partner",
        senderId="fake-agent",
        taskId="task-1",
        status=TaskStatus(
            state=TaskState.AwaitingCompletion,
            stateChangedAt="2026-10-07T00:00:00+00:00",
        ),
        products=[
            Product(
                id="product-1",
                dataItems=[StructuredDataItem(data=data)],
            )
        ],
    )


def test_attacker_uses_aip_start_and_parses_product(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_client = FakeAipClient(task_result({"samples": [{"type": "defect", "content": "x"}], "agentMode": "llm"}))
    monkeypatch.setenv("AGENT_ATTACKER_RPC_URL", "https://attacker.example/rpc")
    monkeypatch.setattr(acp_agents, "AipRpcClient", lambda **_: fake_client)

    result = asyncio.run(acp_agents.call_attacker({"difficulty": "low", "topic": "test"}))

    assert result == {"samples": [{"type": "defect", "content": "x"}], "agentMode": "llm", "agentSource": "acp-llm"}
    assert json.loads(fake_client.request["user_input"]) == {"difficulty": "low", "topic": "test"}
    assert fake_client.request["session_id"].startswith("session-")
    assert fake_client.closed


def test_task_polling_uses_capped_exponential_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    completed = task_result({"samples": []})
    working = completed.model_copy(update={
        "status": TaskStatus(
            state=TaskState.Working,
            stateChangedAt="2026-10-07T00:00:00+00:00",
        )
    })

    class PollingClient(FakeAipClient):
        def __init__(self) -> None:
            super().__init__(completed)
            self.states = [working, working, completed, completed]

        async def start_task(self, *, session_id: str, user_input: str) -> TaskResult:
            self.request = {"session_id": session_id, "user_input": user_input}
            return self.states.pop(0)

        async def get_task(self, *, task_id: str, session_id: str) -> TaskResult:
            return self.states.pop(0)

    fake_client = PollingClient()
    delays: list[float] = []

    async def fake_sleep(delay: float) -> None:
        delays.append(delay)

    monkeypatch.setenv("AGENT_ATTACKER_RPC_URL", "https://attacker.example/rpc")
    monkeypatch.setattr(acp_agents, "AipRpcClient", lambda **_: fake_client)
    monkeypatch.setattr(acp_agents.asyncio, "sleep", fake_sleep)

    assert asyncio.run(acp_agents.call_attacker({"difficulty": "low", "topic": "poll"})) == {
        "samples": [],
        "agentSource": "acp-rule-fallback",
    }
    assert delays == [0.1, 0.2]
    assert fake_client.closed


def test_sdk_posts_aip_v2_start_command(monkeypatch: pytest.MonkeyPatch) -> None:
    from acps_sdk.aip import aip_rpc_client

    request_body: dict[str, object] = {}

    class FakeResponse:
        def __init__(self, data: dict[str, object]) -> None:
            self.data = data
            self.content = json.dumps(data).encode("utf-8")
            self.status_code = 200
            self.text = self.content.decode("utf-8")

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return self.data

    class FakeHttpClient:
        async def post(self, _url, *, json, **_kwargs):
            request_body.update(json)
            return FakeResponse(
                {
                    "jsonrpc": "2.0",
                    "id": json["id"],
                    "result": task_result({"samples": []}).model_dump(
                        mode="json", by_alias=True, exclude_none=True
                    ),
                }
            )

        async def aclose(self) -> None:
            return None

    monkeypatch.setenv("AGENT_ATTACKER_RPC_URL", "https://attacker.example/rpc")
    monkeypatch.setenv("AGENT_AIP_LEADER_ID", "agent-lab-test")
    monkeypatch.delenv("AGENT_RPC_API_KEY", raising=False)
    monkeypatch.setattr(aip_rpc_client.httpx, "AsyncClient", lambda **_kwargs: FakeHttpClient())

    result = asyncio.run(
        acp_agents.call_attacker(
            {"difficulty": "low", "topic": "wire test"},
            correlation_id="call-trace-123",
        )
    )

    command = request_body["params"]["command"]
    assert request_body["method"] == "rpc"
    assert command["command"] == "start"
    assert command["senderRole"] == "leader"
    assert command["senderId"] == "agent-lab-test"
    assert command["sessionId"] == "call-trace-123"
    assert json.loads(command["dataItems"][0]["text"]) == {
        "difficulty": "low",
        "topic": "wire test",
    }
    assert result == {"samples": [], "agentSource": "acp-rule-fallback"}


def test_remote_call_tolerates_semicolon_no_proxy_during_sdk_init(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class ProxySensitiveClient(FakeAipClient):
        def __init__(self, *, partner_url: str, leader_id: str, ssl_context=None) -> None:
            self.http_client = acp_agents.httpx.AsyncClient()
            super().__init__(task_result({"samples": []}))

        async def close(self) -> None:
            await self.http_client.aclose()
            await super().close()

    monkeypatch.setenv("AGENT_ATTACKER_RPC_URL", "https://attacker.example/rpc")
    monkeypatch.setenv("NO_PROXY", "localhost;127.0.0.1;::1;*.cn;*.aliyun.com")
    monkeypatch.setenv("no_proxy", "localhost;127.0.0.1;::1;*.cn;*.aliyun.com")
    monkeypatch.setattr(acp_agents, "AipRpcClient", ProxySensitiveClient)

    result = asyncio.run(
        acp_agents.call_attacker({"difficulty": "low", "topic": "proxy"})
    )

    assert result == {"samples": [], "agentSource": "acp-rule-fallback"}


def test_defender_requires_complete_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_client = FakeAipClient(task_result({
        "caught": [],
        "risks": [],
        "fixed": [],
        "analysisMode": "本地模拟分析",
        "agentSource": "acp-rule-fallback",
    }))
    monkeypatch.setenv("AGENT_DEFENDER_RPC_URL", "https://defender.example/rpc")
    monkeypatch.setattr(acp_agents, "AipRpcClient", lambda **_: fake_client)

    result = asyncio.run(acp_agents.call_defender({"sample": {"content": "test"}}))

    assert result == {
        "caught": [],
        "risks": [],
        "fixed": [],
        "analysisMode": "本地模拟分析",
        "agentSource": "acp-rule-fallback",
    }
    assert json.loads(fake_client.request["user_input"]) == {"sample": {"content": "test"}}


def test_unknown_agent_source_is_preserved(monkeypatch: pytest.MonkeyPatch) -> None:
    source = "partner-agent-v3"
    fake_client = FakeAipClient(task_result({
        "samples": [],
        "agentMode": "experimental",
        "agentSource": source,
    }))
    monkeypatch.setenv("AGENT_ATTACKER_RPC_URL", "https://attacker.example/rpc")
    monkeypatch.setattr(acp_agents, "AipRpcClient", lambda **_: fake_client)

    result = asyncio.run(acp_agents.call_attacker({"difficulty": "low", "topic": "test"}))

    assert result is not None
    assert result["agentSource"] == source


def test_unknown_agent_mode_is_not_reported_as_rule_fallback() -> None:
    result = acp_agents._validate_result("attacker", {
        "samples": [],
        "agentMode": "experimental",
    })

    assert result["agentSource"] == "acp-unknown:experimental"


def test_remote_failure_does_not_fall_back_to_local(monkeypatch: pytest.MonkeyPatch) -> None:
    class BrokenClient(FakeAipClient):
        async def start_task(self, *, session_id: str, user_input: str) -> TaskResult:
            raise OSError("connection refused")

    fake_client = BrokenClient(task_result({"samples": []}))
    monkeypatch.setenv("AGENT_ATTACKER_RPC_URL", "https://attacker.example/rpc")
    monkeypatch.setattr(acp_agents, "AipRpcClient", lambda **_: fake_client)

    with pytest.raises(acp_agents.ACPAgentError, match="调用失败"):
        asyncio.run(acp_agents.call_attacker({"difficulty": "low", "topic": "test"}))
    assert fake_client.closed


def test_remote_transient_failure_retries_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    class FlakyClient(FakeAipClient):
        def __init__(self) -> None:
            super().__init__(task_result({"samples": []}))
            self.attempts = 0

        async def start_task(self, *, session_id: str, user_input: str) -> TaskResult:
            self.attempts += 1
            if self.attempts == 1:
                raise OSError("connection reset")
            return await super().start_task(session_id=session_id, user_input=user_input)

    fake_client = FlakyClient()
    monkeypatch.setenv("AGENT_ATTACKER_RPC_URL", "https://attacker.example/rpc")
    monkeypatch.setenv("AGENT_RPC_RETRIES", "1")
    monkeypatch.setattr(acp_agents, "AipRpcClient", lambda **_: fake_client)
    original_sleep = acp_agents.asyncio.sleep

    async def no_sleep(_delay: float) -> None:
        await original_sleep(0)

    monkeypatch.setattr(acp_agents.asyncio, "sleep", no_sleep)

    result = asyncio.run(acp_agents.call_attacker({"difficulty": "low", "topic": "retry"}))

    assert result == {"samples": [], "agentSource": "acp-rule-fallback"}
    assert fake_client.attempts == 2


def test_unconfigured_role_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_ATTACKER_RPC_URL", raising=False)
    assert asyncio.run(acp_agents.call_attacker({"difficulty": "low", "topic": "test"})) is None


def test_local_rpc_disables_sdk_identity_binding(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_ATTACKER_EXPECTED_AIC", raising=False)
    monkeypatch.delenv("AGENT_AIP_EXPECTED_PARTNER_AIC", raising=False)
    assert acp_agents._identity_binding_options("attacker", None) == {
        "identity_binding_enabled": False
    }


def test_remote_identity_binding_requires_peer_aic_and_mtls(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_ATTACKER_EXPECTED_AIC", "acps://peer")
    with pytest.raises(acp_agents.ACPAgentError, match="未配置 mTLS"):
        acp_agents._identity_binding_options("attacker", None)


def test_locked_sdk_options_are_filtered() -> None:
    class LegacyAipClient:
        def __init__(self, partner_url: str, leader_id: str, ssl_context=None) -> None:
            pass

    options = acp_agents._supported_options(
        LegacyAipClient,
        {
            "partner_url": "http://127.0.0.1/rpc",
            "leader_id": "leader",
            "ssl_context": None,
            "transport": object(),
            "identity_binding_enabled": False,
        },
    )

    assert options == {
        "partner_url": "http://127.0.0.1/rpc",
        "leader_id": "leader",
        "ssl_context": None,
    }
