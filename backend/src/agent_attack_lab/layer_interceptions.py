"""Derive four-layer interception counts from recorded defense evidence.

These counters describe the persisted battle samples, not device telemetry. A
round with recorded ``caught`` evidence is assigned to one topic-relevant
layer; a round with only ``risks`` evidence remains a pass because risks are
conditional observations, not an interception decision.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

_LAYER_NAMES = (
    "输入标准化清洗",
    "推理引导",
    "工具动作管控",
    "审计监测恢复",
)

LAYER_CHECK_IDS: tuple[tuple[str, ...], ...] = (
    ("L0-1", "L0-2", "L0-3"),
    ("L1-1", "L1-2", "L1-3"),
    ("L2-1", "L2-2", "L2-3", "L2-4", "L2-5"),
    ("L3-1", "L3-2", "L3-3", "L3-4"),
)

_TOPIC_LAYERS: tuple[tuple[re.Pattern[str], tuple[int, ...]], ...] = (
    (
        re.compile(
            r"提示注入|工单注入|工单备注注入|上下文投毒|越狱诱导|偏见注入",
            re.IGNORECASE,
        ),
        (1, 2),
    ),
    (re.compile(r"sql\s*注入|数据窃取", re.IGNORECASE), (1, 3)),
    (
        re.compile(
            r"权限校验|权限提升|越权测试|越权|工具调用滥用|工具滥用", re.IGNORECASE
        ),
        (2, 3),
    ),
    (
        re.compile(r"通用安全测试|安全测试|general|security", re.IGNORECASE),
        (1, 2, 3, 4),
    ),
)


def _focused_layers(topic: str) -> tuple[int, ...]:
    value = str(topic or "")
    for pattern, layers in _TOPIC_LAYERS:
        if pattern.search(value):
            return layers
    return (1, 2, 3, 4)


def _finding_layer(topic: str, defense: Mapping[str, Any]) -> int | None:
    focused = _focused_layers(topic)
    evidence = [*(defense.get("caught") or []), *(defense.get("risks") or [])]
    text = " ".join(str(item) for item in evidence).lower()
    if re.search(r"sqli|sql\s*注入|customer_id|lab-sqli", text) and 3 in focused:
        return 3
    if re.search(r"prompt|提示|越狱|jailbreak|注入", text) and 1 in focused:
        return 1
    if re.search(r"tenant|越权|权限|tool|工具", text) and 3 in focused:
        return 3
    return None


def _blocking_check(layer_index: int, defense: Mapping[str, Any]) -> int:
    evidence = defense.get("caught") or []
    text = " ".join(
        str(item.get("ruleId", "")) + " " + str(item.get("owaspCategory", ""))
        for item in evidence
        if isinstance(item, Mapping)
    ).lower()
    if layer_index == 0:
        return 1 if re.search(r"prompt|llm01|llm07", text) else 2
    if layer_index == 1:
        return 2 if re.search(r"prompt|llm01|llm07", text) else 0
    if layer_index == 2:
        if re.search(r"tenant|permission|llm02", text):
            return 2
        if re.search(r"sql|path|webhook|ssrf|llm05|llm06", text):
            return 1
        return 0
    return 2


def derive_round_layer_trace(
    topic: str, defense: Mapping[str, Any]
) -> list[dict[str, Any]]:
    """Project recorded defense evidence onto the documented L0-L3 checks.

    This is an explicit backend projection of persisted findings, not device
    telemetry. Every emitted decision includes that basis and the rule IDs that
    support a block. A round stops at the first derived blocking layer.
    """

    caught = defense.get("caught") or []
    evidence_ids = [
        str(item.get("ruleId"))
        for item in caught
        if isinstance(item, Mapping) and item.get("ruleId")
    ]
    block_layer = _finding_layer(topic, defense) if caught else None
    if caught and block_layer is None:
        focused = _focused_layers(topic)
        block_layer = focused[0]
    block_index = block_layer - 1 if block_layer is not None else None
    blocking_check = (
        _blocking_check(block_index, defense) if block_index is not None else None
    )

    trace: list[dict[str, Any]] = []
    for layer_index, checks in enumerate(LAYER_CHECK_IDS):
        if block_index is not None and layer_index > block_index:
            break
        decisions = []
        for check_index, stage_id in enumerate(checks):
            if block_index == layer_index and blocking_check is not None:
                if check_index < blocking_check:
                    status = "passed"
                elif check_index == blocking_check:
                    status = "blocked"
                else:
                    status = "skipped-by-block"
            else:
                status = "passed"
            decisions.append(
                {
                    "stageId": stage_id,
                    "status": status,
                    "evidenceIds": evidence_ids if status == "blocked" else [],
                }
            )
        trace.append(
            {
                "layerIndex": layer_index,
                "layer": f"L{layer_index}",
                "name": _LAYER_NAMES[layer_index],
                "applicableChecks": list(checks),
                "checks": decisions,
                "confirmedPassed": all(
                    item["status"] == "passed" for item in decisions
                ),
                "basis": "derived_from_defense_results",
            }
        )
    return trace


def derive_layer_interceptions(
    topic: str,
    defense_results: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Return layer totals derived solely from recorded defense results.

    ``total`` is the number of recorded rounds. Every layer satisfies
    ``blocked + passed == reached``; only rounds that passed all prior layers
    contribute to the next layer's ``reached`` count. Findings from one round
    are intentionally collapsed to one blocking layer so totals cannot
    double-count a sample.
    """

    total = len(defense_results)
    block_layers: list[int | None] = []
    focused = _focused_layers(topic)
    for round_index, defense in enumerate(defense_results):
        caught = defense.get("caught") or []
        if not caught:
            block_layers.append(None)
            continue

        detected = _finding_layer(topic, defense)
        block_layers.append(
            detected if detected is not None else focused[round_index % len(focused)]
        )

    active = [True] * total
    layers = []
    for index in range(1, 5):
        reached = sum(active)
        blocked = sum(
            is_active and block_layer == index
            for is_active, block_layer in zip(active, block_layers)
        )
        passed = reached - blocked
        layers.append(
            {
                "layer": index,
                "name": _LAYER_NAMES[index - 1],
                "total": total,
                "reached": reached,
                "blocked": blocked,
                "passed": passed,
            }
        )
        active = [
            is_active and block_layer != index
            for is_active, block_layer in zip(active, block_layers)
        ]
    return {
        "basis": "derived_from_defense_results",
        "total": total,
        "layers": layers,
    }
