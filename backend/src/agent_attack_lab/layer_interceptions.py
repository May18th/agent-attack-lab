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
