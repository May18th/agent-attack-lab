"""AIP v2 RPC client adapters for independent attacker and defender agents."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import ssl
import time
import uuid
from typing import Any, Literal

import httpx
from acps_sdk.aip import AipRpcClient, StructuredDataItem, TaskResult, TextDataItem

Role = Literal["attacker", "defender"]
logger = logging.getLogger("agent_attack_lab.acp")
_rpc_retry_count = 0
_rpc_timeout_count = 0


class ACPAgentError(RuntimeError):
    """A remote ACP agent could not return a usable AIP task result."""


def _rpc_timeout_seconds() -> float:
    try:
        return min(max(float(os.getenv("AGENT_RPC_TIMEOUT_SECONDS", "90")), 5.0), 300.0)
    except ValueError:
        return 90.0


def _rpc_retries() -> int:
    try:
        return min(max(int(os.getenv("AGENT_RPC_RETRIES", "2")), 0), 3)
    except ValueError:
        return 2


def _is_retryable_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response is None or exc.response.status_code >= 500
    return isinstance(
        exc,
        (
            asyncio.TimeoutError,
            TimeoutError,
            ConnectionError,
            OSError,
            httpx.TimeoutException,
            httpx.NetworkError,
            httpx.RemoteProtocolError,
            httpx.ReadError,
        ),
    )


def rpc_metrics() -> dict[str, int]:
    return {"retries": _rpc_retry_count, "timeouts": _rpc_timeout_count}


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
    except OSError, ssl.SSLError, ValueError:
        raise ACPAgentError("ACP mTLS 证书配置无效") from None


def _identity_binding_options(
    role: Role, ssl_context: ssl.SSLContext | None
) -> dict[str, Any]:
    """Configure AIP identity checks without breaking local loopback agents.

    The current SDK requires ``expected_partner_aic`` whenever identity binding
    is enabled. Local development agents do not have platform-issued AICs, so
    they use explicit non-mTLS HTTP endpoints. Production callers can opt in by
    supplying the role-specific peer AIC together with the mTLS settings.
    """
    expected_partner_aic = os.getenv(
        f"AGENT_{role.upper()}_EXPECTED_AIC",
        os.getenv("AGENT_AIP_EXPECTED_PARTNER_AIC", ""),
    ).strip()
    if not expected_partner_aic:
        return {"identity_binding_enabled": False}
    if ssl_context is None:
        raise ACPAgentError(
            f"ACP {role} 已配置对端 AIC，但未配置 mTLS 客户端证书和信任链"
        )
    return {
        "expected_partner_aic": expected_partner_aic,
        "identity_binding_enabled": True,
    }


def _supported_options(callable_obj: Any, options: dict[str, Any]) -> dict[str, Any]:
    """Keep calls compatible with both the locked and public ACP SDK shapes."""
    parameters = inspect.signature(callable_obj).parameters
    if any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD
        for parameter in parameters.values()
    ):
        return options
    return {key: value for key, value in options.items() if key in parameters}


def _construct_aip_client(options: dict[str, Any]) -> AipRpcClient:
    """Construct the SDK client without letting malformed Windows proxy env leak in."""
    proxy_vars = ("NO_PROXY", "no_proxy")
    saved = {name: os.environ.get(name) for name in proxy_vars}
    sanitize = any(value and ";" in value for value in saved.values())
    if sanitize:
        for name in proxy_vars:
            os.environ.pop(name, None)
    try:
        return AipRpcClient(**options)
    finally:
        if sanitize:
            for name, value in saved.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value


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
            except TypeError, ValueError:
                continue
            if isinstance(data, dict):
                return data
    raise ACPAgentError("远端 AIP 任务没有返回结构化 JSON 结果")


def _validate_result(role: Role, data: dict[str, Any]) -> dict[str, Any]:
    expected = ("samples",) if role == "attacker" else ("caught", "risks", "fixed")
    for field in expected:
        values = data.get(field)
        if not isinstance(values, list) or any(
            not isinstance(item, dict) for item in values
        ):
            raise ACPAgentError(
                f"远端 {role} Agent 响应格式无效：{field} 必须是对象数组"
            )
    result = {field: data[field] for field in expected}
    if isinstance(data.get("agentMode"), str):
        result["agentMode"] = data["agentMode"]
    if role == "defender":
        for field in ("analysisMode", "verificationStatus", "scopeNotice"):
            if isinstance(data.get(field), str):
                result[field] = data[field]
    source = data.get("agentSource")
    if isinstance(source, str) and source.strip():
        result["agentSource"] = source
    else:
        mode = result.get("agentMode", "local-rule-fallback")
        known_sources = {
            "llm": "acp-llm",
            "local-rule": "acp-rule-fallback",
            "local-rule-fallback": "acp-rule-fallback",
        }
        result["agentSource"] = known_sources.get(mode, f"acp-unknown:{mode}")
    return result


async def _invoke(
    role: Role,
    payload: dict[str, Any],
    *,
    correlation_id: str | None = None,
) -> dict[str, Any] | None:
    endpoint = os.getenv(f"AGENT_{role.upper()}_RPC_URL", "").strip()
    if not endpoint:
        return None

    timeout_seconds = _rpc_timeout_seconds()
    retries = _rpc_retries()
    client: AipRpcClient | None = None
    try:
        ssl_context = _ssl_context()
        # The SDK's default httpx client parses the process NO_PROXY value.
        # Windows proxy tools commonly use semicolon-separated patterns, which
        # httpx treats as malformed URL patterns. An explicit transport keeps
        # loopback and mTLS calls independent from ambient proxy settings.
        transport = httpx.AsyncHTTPTransport(
            verify=ssl_context if ssl_context else True,
            trust_env=False,
        )
        client_options = {
            "partner_url": endpoint,
            "leader_id": os.getenv(
                "AGENT_AIP_LEADER_ID", "agent-attack-lab-dev"
            ).strip()
            or "agent-attack-lab-dev",
            "ssl_context": ssl_context,
            "transport": transport,
            **_identity_binding_options(role, ssl_context),
        }
        client_parameters = inspect.signature(AipRpcClient).parameters
        client = _construct_aip_client(_supported_options(AipRpcClient, client_options))
        if "transport" not in client_parameters and not any(
            parameter.kind is inspect.Parameter.VAR_KEYWORD
            for parameter in client_parameters.values()
        ):
            # acps-sdk 2.1.0 has no transport constructor argument. Replace its
            # default client so loopback calls still ignore ambient proxy settings.
            original_http = client.http_client
            client.http_client = httpx.AsyncClient(
                transport=transport,
                verify=ssl_context if ssl_context else True,
                trust_env=False,
            )
            await original_http.aclose()
        rpc_api_key = os.getenv("AGENT_RPC_API_KEY", "").strip()
        if rpc_api_key:
            # SDK 客户端不支持自定义 header；替换其内部 httpx 客户端注入 X-API-Key。
            # trust_env=False 避免本机系统代理劫持 127.0.0.1 调用。
            original_http = client.http_client
            client.http_client = httpx.AsyncClient(
                headers={"X-API-Key": rpc_api_key},
                verify=ssl_context if ssl_context else True,
                trust_env=False,
            )
            await original_http.aclose()
        session_id = correlation_id or f"session-{uuid.uuid4()}"

        async def start_and_wait() -> TaskResult:
            task = await client.start_task(
                session_id=session_id,
                user_input=json.dumps(
                    payload, ensure_ascii=False, separators=(",", ":")
                ),
            )
            deadline = time.monotonic() + timeout_seconds - 1
            poll_interval = 0.1
            while _state_name(task) in {"accepted", "working"}:
                if time.monotonic() >= deadline:
                    raise TimeoutError
                await asyncio.sleep(poll_interval)
                poll_interval = min(poll_interval * 2, 0.5)
                task = await client.get_task(task_id=task.taskId, session_id=session_id)
            return task

        global _rpc_retry_count, _rpc_timeout_count
        attempt = 0
        while True:
            try:
                task = await asyncio.wait_for(start_and_wait(), timeout=timeout_seconds)
                break
            except TimeoutError:
                _rpc_timeout_count += 1
                if attempt >= retries:
                    raise
                _rpc_retry_count += 1
            except Exception as exc:
                if not _is_retryable_error(exc) or attempt >= retries:
                    raise
                _rpc_retry_count += 1
            await asyncio.sleep(min(0.1 * (2**attempt), 0.5))
            attempt += 1
        return _validate_result(role, _task_data(task))
    except TimeoutError:
        logger.warning("Remote %s ACP Agent timed out", role)
        raise ACPAgentError(f"远端 {role} ACP Agent 请求超时") from None
    except ACPAgentError:
        raise
    except Exception as exc:  # noqa: BLE001 - normalize unexpected remote SDK failures.
        logger.warning("Remote %s ACP Agent failed (%s)", role, type(exc).__name__)
        raise ACPAgentError(f"远端 {role} ACP Agent 调用失败") from None
    finally:
        if client is not None:
            await client.close()


async def call_attacker(
    payload: dict[str, Any], *, correlation_id: str | None = None
) -> dict[str, Any] | None:
    return await _invoke("attacker", payload, correlation_id=correlation_id)


async def call_defender(
    payload: dict[str, Any], *, correlation_id: str | None = None
) -> dict[str, Any] | None:
    return await _invoke("defender", payload, correlation_id=correlation_id)
