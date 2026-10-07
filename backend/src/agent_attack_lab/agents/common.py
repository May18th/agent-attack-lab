"""Shared AIP v2 server setup for the standalone local agents."""

from __future__ import annotations

import json
import inspect
import uuid
from collections.abc import Callable
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
from fastapi import FastAPI, Request

from agent_attack_lab.agents.llm_runtime import is_configured as llm_configured


def _command_payload(command: TaskCommand) -> dict[str, Any]:
    payload = (command.commandParams or {}).get("payload")
    if isinstance(payload, dict):
        return payload

    for item in command.dataItems or []:
        if isinstance(item, StructuredDataItem):
            return item.data
        if isinstance(item, TextDataItem):
            try:
                payload = json.loads(item.text)
            except (TypeError, ValueError) as exc:
                raise ValueError("AIP 输入必须是 JSON 对象") from exc
            if isinstance(payload, dict):
                return payload
            raise ValueError("AIP 输入必须是 JSON 对象")

    raise ValueError("AIP Start 命令缺少 JSON 输入")


def create_agent_app(
    name: str,
    process: Callable[[dict[str, Any]], dict[str, Any]],
) -> FastAPI:
    async def on_start(command: TaskCommand, task: TaskResult | None) -> TaskResult:
        result = await DefaultHandlers.start(command, task)
        if task is not None:
            return result

        output = process(_command_payload(command))
        if inspect.isawaitable(output):
            output = await output
        data_item = StructuredDataItem(data=output)
        TaskManager.set_products(
            command.taskId,
            [
                Product(
                    id=f"product-{uuid.uuid4()}",
                    name=f"{name}-result",
                    dataItems=[data_item],
                )
            ],
        )
        return TaskManager.update_task_status(
            command.taskId,
            TaskState.AwaitingCompletion,
            data_items=[data_item],
        )

    handlers = CommandHandlers(on_start=on_start)
    app = FastAPI(
        title=f"{name.title()} ACP Agent",
        description=f"Standalone AIP v2 RPC service for the {name} role.",
        version="1.0.0",
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {
            "status": "ok",
            "agent": name,
            "protocol": "AIP v2",
            "agentMode": "llm" if llm_configured() else "local-rule",
        }

    @app.post("/rpc")
    async def rpc(request: Request) -> dict[str, Any]:
        response = await handle_rpc_request(request, handlers)
        return response.model_dump(by_alias=True, exclude_none=True)

    return app
