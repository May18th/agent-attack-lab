"""JSON-RPC and the legacy agent endpoints.

``/rpc`` speaks two dialects: an AIP ``rpc`` envelope, which is handed to the
SDK, and a bare ``{"method": "attack"|"defend"}`` form kept for older callers.
Both are ``include_in_schema=False`` because they are integration surfaces, not
part of the documented public API.
"""

from __future__ import annotations

import json
import uuid
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
from fastapi import APIRouter, Depends, Request

from agent_attack_lab import config, security
from agent_attack_lab.agent_logic import AttackRequest, DefendRequest, attack, defend
from agent_attack_lab.aip_compat import server_identity_options
from agent_attack_lab.models import JsonRpcRequest

router = APIRouter()

_aip_server_options = server_identity_options(
    handle_rpc_request,
    local_aic=config.local_aic,
    enabled=config.identity_binding_enabled,
    setting_name="AGENT_IDENTITY_BINDING_ENABLED",
)


@router.post(
    "/agent/attack",
    dependencies=[
        Depends(security.api_key_dependency),
        Depends(security.rate_limit_dependency),
    ],
    include_in_schema=False,
)
def agent_attack(payload: AttackRequest) -> dict[str, Any]:
    return attack(payload)


@router.post(
    "/agent/defend",
    dependencies=[
        Depends(security.api_key_dependency),
        Depends(security.rate_limit_dependency),
    ],
    include_in_schema=False,
)
def agent_defend(payload: DefendRequest) -> dict[str, Any]:
    result = defend(payload)
    return {key: result[key] for key in ("caught", "risks", "fixed")}


def _command_text(command: TaskCommand) -> str:
    for item in command.dataItems or []:
        if isinstance(item, TextDataItem):
            return item.text
    return ""


async def _aip_start(command: TaskCommand, task: TaskResult | None) -> TaskResult:
    await DefaultHandlers.start(command, task)
    command_params = command.commandParams or {}
    payload: dict[str, Any] = command_params.get("payload", {})
    if not payload:
        try:
            parsed = json.loads(_command_text(command))
            if isinstance(parsed, dict):
                payload = parsed
        except TypeError, ValueError:
            payload = {"topic": _command_text(command)}

    action = command_params.get("action")
    if action is None:
        action = "defend" if "sample" in payload else "attack"
    output = (
        defend(DefendRequest.model_validate(payload))
        if action == "defend"
        else attack(AttackRequest.model_validate(payload))
    )
    data_item = StructuredDataItem(data=output)
    TaskManager.set_products(
        command.taskId,
        [
            Product(
                id=f"product-{uuid.uuid4()}",
                name=f"{action}-result",
                dataItems=[data_item],
            )
        ],
    )
    return TaskManager.update_task_status(
        command.taskId, TaskState.AwaitingCompletion, data_items=[data_item]
    )


_aip_handlers = CommandHandlers(on_start=_aip_start)


@router.post(
    "/rpc",
    dependencies=[
        Depends(security.api_key_dependency),
        Depends(security.rate_limit_dependency),
    ],
    include_in_schema=False,
)
async def rpc(request: Request) -> dict[str, Any]:
    """JSON-RPC endpoint supporting both AIP ``rpc`` and simple agent methods."""
    body = await request.json()
    if body.get("method") == "rpc":
        response = await handle_rpc_request(
            request, _aip_handlers, **_aip_server_options
        )
        return response.model_dump(by_alias=True, exclude_none=True)

    parsed_request = JsonRpcRequest.model_validate(body)
    params = parsed_request.params or {}
    try:
        if parsed_request.method == "attack":
            result = attack(AttackRequest.model_validate(params))
        elif parsed_request.method == "defend":
            result = defend(DefendRequest.model_validate(params))
        else:
            return {
                "jsonrpc": "2.0",
                "id": parsed_request.id,
                "error": {"code": -32601, "message": "Method not found"},
            }
    except Exception as exc:  # noqa: BLE001 - JSON-RPC boundary must normalize all validation errors.
        return {
            "jsonrpc": "2.0",
            "id": parsed_request.id,
            "error": {"code": -32602, "message": "Invalid params", "data": str(exc)},
        }
    return {"jsonrpc": "2.0", "id": parsed_request.id, "result": result}
