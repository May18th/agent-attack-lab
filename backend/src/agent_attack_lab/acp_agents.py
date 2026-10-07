"""AIP v2 RPC client adapters for independent attacker and defender agents."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import ssl
import time
import uuid
from typing import Any, Literal

from acps_sdk.aip import AipRpcClient, StructuredDataItem, TaskResult, TextDataItem


Role = Literal["attacker", "defender"]
logger = logging.getLogger("agent_attack_lab.acp")


class ACPAgentError(RuntimeError):
    """A remote ACP agent could not return a usable AIP task result."""


def _rpc_timeout_seconds() -> float:
    try:
        return min(max(float(os.getenv("AGENT_RPC_TIMEOUT_SECONDS", "90")), 5.0), 300.0)
    except ValueError:
        return 90.0


def _state_name(task: TaskResult) -> str:
    state = task.status.state
    return state.value if hasattr(state, "value") else str(state)


def is_configured(role: Role) -> bool:
    return bool(os.getenv(f"AGENT_{role.upper()}_RPC_URL", "").strip())


def _ssl_context() -> ssl.SSLContext | None:
    cert_file = os.getenv("AGENT_AIP_MTLS_CERT_FILE", "").strip()
    key_file = os.getenv("AGENT_AIP_MTLS_KEY_FILE", "").strip()
    ca_file = os.getenv("AGENT_AIP_CA_FILE", "").strip()
    if bool(cert_file) != bool(key_file):
        raise ACPAgentError("ACP mTLS 配置不完整：客户端证书和私钥必须同时配置")
    if not any((cert_file, key_file, ca_file)):
        return None

    try:
        context = ssl.create_default_context(cafile=ca_file or None)
        if cert_file:
            context.load_cert_chain(certfile=cert_file, keyfile=key_file)
        return context
    except (OSError, ssl.SSLError, ValueError) as exc:
        raise ACPAgentError("ACP mTLS 证书配置无效") from None


def _task_data(task: TaskResult) -> dict[str, Any]:
    state = _state_name(task)
    if state in {"failed", "rejected", "canceled"}:
        raise ACPAgentError(f"远端 AIP 任务未成功结束（{state}）")

    items = [item for product in (task.products or []) for item in product.dataItems]
    items.extend(task.status.dataItems or [])
    for item in items:
        if isinstance(item, StructuredDataItem):
            return item.data
        if isinstance(item, TextDataItem):
            try:
                data = json.loads(item.text)
            except (TypeError, ValueError):
                continue
            if isinstance(data, dict):
                return data
    raise ACPAgentError("远端 AIP 任务没有返回结构化 JSON 结果")


def _validate_result(role: Role, data: dict[str, Any]) -> dict[str, Any]:
    expected = ("samples",) if role == "attacker" else ("caught", "risks", "fixed")
    for field in expected:
        values = data.get(field)
        if not isinstance(values, list) or any(not isinstance(item, dict) for item in values):
            raise ACPAgentError(f"远端 {role} Agent 响应格式无效：{field} 必须是对象数组")
    result = {field: data[field] for field in expected}
    if isinstance(data.get("agentMode"), str):
        result["agentMode"] = data["agentMode"]
    if role == "defender":
        for field in ("analysisMode", "verificationStatus", "scopeNotice"):
            if isinstance(data.get(field), str):
                result[field] = data[field]
    mode = result.get("agentMode", "local-rule-fallback")
    result["agentSource"] = "acp-llm" if mode == "llm" else "acp-rule-fallback"
    return result


async def _invoke(role: Role, payload: dict[str, Any]) -> dict[str, Any] | None:
    endpoint = os.getenv(f"AGENT_{role.upper()}_RPC_URL", "").strip()
    if not endpoint:
        return None

    timeout_seconds = _rpc_timeout_seconds()
    client: AipRpcClient | None = None
    try:
        client = AipRpcClient(
            partner_url=endpoint,
            leader_id=os.getenv("AGENT_AIP_LEADER_ID", "agent-attack-lab-dev").strip()
            or "agent-attack-lab-dev",
            ssl_context=_ssl_context(),
        )
        session_id = f"session-{uuid.uuid4()}"

        async def start_and_wait() -> TaskResult:
            task = await client.start_task(
                session_id=session_id,
                user_input=json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            )
            deadline = time.monotonic() + timeout_seconds - 1
            while _state_name(task) in {"accepted", "working"}:
                if time.monotonic() >= deadline:
                    raise asyncio.TimeoutError
                await asyncio.sleep(0.5)
                task = await client.get_task(task_id=task.taskId, session_id=session_id)
            return task

        task = await asyncio.wait_for(start_and_wait(), timeout=timeout_seconds)
        return _validate_result(role, _task_data(task))
    except asyncio.TimeoutError as exc:
        logger.warning("Remote %s ACP Agent timed out", role)
        raise ACPAgentError(f"远端 {role} ACP Agent 请求超时") from None
    except ACPAgentError:
        raise
    except Exception as exc:
        logger.warning("Remote %s ACP Agent failed (%s)", role, type(exc).__name__)
        raise ACPAgentError(f"远端 {role} ACP Agent 调用失败") from None
    finally:
        if client is not None:
            await client.close()


async def call_attacker(payload: dict[str, Any]) -> dict[str, Any] | None:
    return await _invoke("attacker", payload)


async def call_defender(payload: dict[str, Any]) -> dict[str, Any] | None:
    return await _invoke("defender", payload)
