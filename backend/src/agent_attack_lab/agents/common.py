"""Shared AIP v2 server setup for the standalone local agents."""

from __future__ import annotations

import inspect
import json
import logging
import os
import uuid
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Any

from acps_sdk.aip import (
    Product,
    StructuredDataItem,
    TaskCommand,
    TaskResult,
    TaskState,
    TextDataItem,
)
from acps_sdk.aip.aip_rpc_server import (
    CommandHandlers,
    DefaultHandlers,
    TaskManager,
    handle_rpc_request,
)
from fastapi import FastAPI, HTTPException, Request

from agent_attack_lab import amp
from agent_attack_lab.agents.llm_runtime import is_configured as llm_configured
from agent_attack_lab.aip_compat import server_identity_options
from agent_attack_lab.logging_setup import configure_logging

configure_logging()

logger = logging.getLogger("agent_attack_lab.agents.common")


# 平台协作入口（如叮当）派发的是自然语言指令，而不是 ACS 约定的结构化字段。
# 这类请求在 TextDataItem 里是一段人话，json.loads 必然失败；若直接抛错，
# 平台侧只会看到 "AIP 输入必须是 JSON 对象"，整条互联链路就断在格式上。
# 因此非 JSON 文本一律降级为最小可用载荷：攻击方按 topic 取用，
# 防守方按 sample.content 取用，同一段指令两边都能消费。
_INSTRUCTION_TOPIC_LIMIT = 200  # 与 AttackRequest.topic 的 max_length 对齐
_INSTRUCTION_CONTENT_LIMIT = 8000  # 与 defender 的 content 截断长度对齐


def _instruction_payload(text: str) -> dict[str, Any]:
    instruction = text.strip()
    topic = instruction[:_INSTRUCTION_TOPIC_LIMIT] or "general"
    return {
        "instruction": instruction,
        "text": instruction,
        "topic": topic,
        "sample": {
            "content": instruction[:_INSTRUCTION_CONTENT_LIMIT],
            "topic": topic,
        },
    }


def _command_payload(command: TaskCommand) -> dict[str, Any]:
    payload = (command.commandParams or {}).get("payload")
    if isinstance(payload, dict):
        return payload

    for item in command.dataItems or []:
        if isinstance(item, StructuredDataItem):
            return item.data
        if isinstance(item, TextDataItem):
            text = (item.text or "").strip()
            if not text:
                continue
            try:
                payload = json.loads(text)
            except TypeError, ValueError:
                payload = None
            if isinstance(payload, dict):
                return payload
            logger.info(
                "AIP 输入为自然语言指令（非 JSON），按通用载荷处理：%s",
                text[:80],
            )
            return _instruction_payload(text)

    raise ValueError("AIP Start 命令缺少 JSON 输入")


def _summarize_output(output: dict[str, Any]) -> str:
    """把智能体的结构化输出压缩成一段平台可直接展示的文本摘要。"""
    try:
        samples = output.get("samples") if isinstance(output, dict) else None
        if isinstance(samples, list) and samples:
            lines: list[str] = []
            for idx, sample in enumerate(samples[:3], start=1):
                if not isinstance(sample, dict):
                    continue
                head = sample.get("scenario") or sample.get("tactic") or "测试样本"
                objective = sample.get("objective") or ""
                content = str(sample.get("content") or "").strip()
                lines.append(f"{idx}. 场景：{head}")
                if objective:
                    lines.append(f"   检查目标：{objective}")
                if content:
                    lines.append(f"   测试文本：{content[:300]}")
            extra = len(samples) - 3
            if extra > 0:
                lines.append(f"（另有 {extra} 条样本，详见结构化数据）")
            return "\n".join(lines) or "已完成任务，结果见结构化数据。"

        if isinstance(output, dict) and output:
            brief = json.dumps(output, ensure_ascii=False)
            if len(brief) > 600:
                brief = brief[:600] + "…"
            return f"已完成任务，结果摘要：{brief}"
    except RecursionError, TypeError, ValueError:
        logger.debug("生成 Agent 文本摘要失败，保留结构化结果", exc_info=True)
    return "已完成任务，结果见结构化数据。"


def create_agent_app(
    name: str,
    process: Callable[[dict[str, Any]], dict[str, Any]],
) -> FastAPI:
    local_aic = os.getenv("AGENT_LOCAL_AIC", "").strip() or None
    # Partner agents use a dedicated switch so the Leader can keep platform
    # identity binding on while local loopback calls stay on HTTP + API key.
    # Identity binding only makes sense over real mTLS channels.
    identity_binding_enabled = os.getenv(
        "AGENT_PARTNER_IDENTITY_BINDING_ENABLED", ""
    ).strip().lower() in {"1", "true", "yes", "on"}
    if identity_binding_enabled and not local_aic:
        raise RuntimeError(
            "AGENT_PARTNER_IDENTITY_BINDING_ENABLED 已开启，但未配置 AGENT_LOCAL_AIC"
        )
    aip_server_options = server_identity_options(
        handle_rpc_request,
        local_aic=local_aic,
        enabled=identity_binding_enabled,
        setting_name="AGENT_PARTNER_IDENTITY_BINDING_ENABLED",
    )

    async def on_start(command: TaskCommand, task: TaskResult | None) -> TaskResult:
        result = await DefaultHandlers.start(command, task)
        if task is not None:
            return result

        output = process(_command_payload(command))
        if inspect.isawaitable(output):
            output = await output
        data_item = StructuredDataItem(data=output)
        # 协作平台（如叮当）整合产物时读取 TextDataItem 正文；只给结构化数据
        # 会被判为"未提供文本正文"而无法展示。附带一段可读摘要作为正文。
        text_item = TextDataItem(text=_summarize_output(output))
        TaskManager.set_products(
            command.taskId,
            [
                Product(
                    id=f"product-{uuid.uuid4()}",
                    name=f"{name}-result",
                    dataItems=[data_item, text_item],
                )
            ],
        )
        return TaskManager.update_task_status(
            command.taskId,
            TaskState.AwaitingCompletion,
            data_items=[data_item],
        )

    handlers = CommandHandlers(on_start=on_start)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        # AMP 心跳：独立 Agent 进程存活期间持续上报，平台才判为 alive=online。
        await amp.start_from_env()
        try:
            yield
        finally:
            await amp.stop_active()

    app = FastAPI(
        title=f"{name.title()} ACP Agent",
        description=f"Standalone AIP v2 RPC service for the {name} role.",
        version="1.0.0",
        lifespan=lifespan,
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {
            "status": "ok",
            "agent": name,
            "protocol": "AIP v2",
            "agentMode": "llm" if llm_configured(role=name) else "local-rule",
        }

    @app.post("/rpc")
    async def rpc(request: Request) -> dict[str, Any]:
        api_key = os.getenv("AGENT_RPC_API_KEY", "").strip()
        if api_key and request.headers.get("x-api-key") != api_key:
            raise HTTPException(status_code=401, detail="invalid or missing X-API-Key")
        response = await handle_rpc_request(request, handlers, **aip_server_options)
        return response.model_dump(by_alias=True, exclude_none=True)

    return app
