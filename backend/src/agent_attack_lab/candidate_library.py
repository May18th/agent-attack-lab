"""Attacker 策略候选库 / Defender 特征候选库（一局记忆 + 跨局记忆）。

每个回合攻防结算后，由后端从回合证据（样本、防守结果、靶标验证、Arbiter
分类）自动构建两条候选记录：

- Attacker 策略候选：Payload 相似度、第 1-4 层各层绕过/阻断规则、攻击意图，
  以及 "Defender 防御规则漏洞"（穿透）或 "拦截原因 / 规则"（被拦截）；
- Defender 特征候选：拦截录入（攻击意图 / 拦截位置 / 拦截手段）或
  穿透录入（攻击意图 / 穿透位置 / 漏洞原因）。

保存范围：
- 一局记忆（battle scope）：按 battleId 保存。前端开新一局时展示的是新
  battleId 的空库，旧战局记录随战局数据保留，不会进入跨局库；
- 跨局记忆（cross scope）：仅当用户开启 "跨局记忆" 开关时写入，跨局保留，
  只能通过 "清空记忆"（``clear_cross``）删除。

智能体学习闭环：下一回合 Attacker / Defender 的上下文会注入各自角色的
候选记录（``agent_memory``）。一局记忆从第 2 回合开始生效；跨局记忆开启时
第 1 回合即可使用长期记忆。角色隔离：Attacker 只读自己的策略记录，
Defender 只读自己的特征记录。

存储是带锁原子写的 JSON 文件（``AGENT_CANDIDATE_LIBRARY_PATH``，默认
``.data/candidate_library.json``），与 BattleStore 的 `.data` 约定一致。
"""

from __future__ import annotations

import json
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Mapping

from agent_attack_lab.battle_timeline import payload_similarity
from agent_attack_lab.layer_interceptions import derive_round_layer_trace

Role = Literal["attacker", "defender"]

MAX_CROSS_ENTRIES_PER_ROLE = 200
MAX_BATTLE_SCOPES = 50
MAX_AGENT_MEMORY_RECORDS = 8
MAX_FIELD_TEXT = 300

_LOCK = threading.Lock()

_LAYER_LABELS = (
    "第1层(L0 输入标准化清洗)",
    "第2层(L1 推理引导)",
    "第3层(L2 工具动作管控)",
    "第4层(L3 审计监测恢复)",
)


def _store_path() -> Path:
    configured = os.getenv("AGENT_CANDIDATE_LIBRARY_PATH", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(".data") / "candidate_library.json"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _text(value: Any, *, limit: int = MAX_FIELD_TEXT) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return text[:limit] if text else ""


def _empty_document() -> dict[str, Any]:
    return {
        "schemaVersion": "candidate.library.v1",
        "updatedAt": _now(),
        "cross": {"attacker": [], "defender": []},
        "battles": {},
    }


def _load() -> dict[str, Any]:
    path = _store_path()
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return _empty_document()
    except (OSError, json.JSONDecodeError):
        return _empty_document()
    if not isinstance(value, dict):
        return _empty_document()
    value.setdefault("schemaVersion", "candidate.library.v1")
    cross = value.get("cross")
    if not isinstance(cross, dict):
        value["cross"] = {"attacker": [], "defender": []}
    else:
        for role in ("attacker", "defender"):
            if not isinstance(cross.get(role), list):
                cross[role] = []
    if not isinstance(value.get("battles"), dict):
        value["battles"] = {}
    return value


def _save(document: dict[str, Any]) -> None:
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    document["updatedAt"] = _now()
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    tmp.replace(path)


# ---------------------------------------------------------------------------
# 字段构建：回合证据 -> 候选记录展示字段
# ---------------------------------------------------------------------------


def _attack_intent(sample: Mapping[str, Any]) -> str:
    for key in ("objective", "tactic", "scenario"):
        value = _text(sample.get(key), limit=120)
        if value:
            return value
    content = _text(sample.get("content"), limit=120)
    return content or "攻击意图未记录"


def _layer_bypass_summary(
    trace: list[Mapping[str, Any]], classification: str
) -> list[str]:
    """把层轨迹转成逐层文字：已绕过哪些检查、在哪层被什么规则拦住。"""
    summaries: list[str] = []
    reached = {str(layer.get("layer")) for layer in trace}
    for index, label in enumerate(_LAYER_LABELS):
        layer_id = f"L{index}"
        if layer_id not in reached:
            summaries.append(f"{label}：未进入（被前置层拦截或短路）")
            continue
        layer = next(item for item in trace if str(item.get("layer")) == layer_id)
        checks = [
            check
            for check in layer.get("checks", [])
            if isinstance(check, Mapping)
        ]
        passed = [
            _text(check.get("name"), limit=60)
            for check in checks
            if check.get("status") == "passed"
        ]
        blocked = next(
            (check for check in checks if check.get("status") == "blocked"), None
        )
        if blocked is not None:
            rules = "、".join(
                _text(rule, limit=40) for rule in blocked.get("evidenceIds", [])
            )
            blocked_name = _text(blocked.get("name"), limit=60) or "未知检查"
            summaries.append(
                f"{label}：被阻断于「{blocked_name}」"
                + (f"（规则：{rules}）" if rules else "")
            )
        elif passed:
            summaries.append(f"{label}：已绕过 {'、'.join(passed)}")
        else:
            summaries.append(f"{label}：无适用检查记录")
    return summaries


def _defender_gap_text(
    classification: str,
    defense: Mapping[str, Any],
    verification: Mapping[str, Any],
) -> str:
    if classification == "full-penetration":
        risks = [
            _text(item.get("reason") if isinstance(item, Mapping) else item, limit=80)
            for item in (defense.get("risks") or [])
        ]
        risks = [item for item in risks if item]
        base = "未在控制窗口内有效控制"
        return f"{base}；风险观察：{'；'.join(risks[:2])}" if risks else base
    if classification == "contained":
        return "L2 已产生模拟效果，L3 控制窗口内完成隔离恢复（存在前置效果缺口）"
    return "—"


def _evidence_text(verification: Mapping[str, Any]) -> str:
    evidence = [
        _text(item, limit=100)
        for item in (verification.get("evidence") or [])
        if isinstance(item, str)
    ]
    return "；".join(item for item in evidence if item)


def build_attacker_fields(
    *,
    sample: Mapping[str, Any],
    defense: Mapping[str, Any],
    verification: Mapping[str, Any],
    classification: str,
    similarity: float | None,
    source_type: str,
    topic: str,
) -> dict[str, str]:
    trace = derive_round_layer_trace(topic, defense)
    layers = _layer_bypass_summary(trace, classification)
    similarity_text = (
        "baseline（首回合）"
        if similarity is None
        else f"{similarity:.2f} · {source_type}"
    )
    intent = _attack_intent(sample)
    penetrated = classification in {"contained", "full-penetration"}
    fields = {
        "Payload 相似度": similarity_text,
        f"{_LAYER_LABELS[0]}绕过规则": layers[0],
        f"{_LAYER_LABELS[1]}绕过规则": layers[1],
        f"{_LAYER_LABELS[2]}绕过规则": layers[2],
        f"{_LAYER_LABELS[3]}绕过规则": layers[3],
        "攻击意图": intent,
    }
    if penetrated:
        fields["Defender 防御规则漏洞"] = _defender_gap_text(
            classification, defense, verification
        )
    else:
        blocked_summary = next(
            (item for item in layers if "被阻断于" in item), None
        )
        caught = [
            _text(item.get("reason") if isinstance(item, Mapping) else item, limit=80)
            for item in (defense.get("caught") or [])
        ]
        caught = [item for item in caught if item]
        reason = "；".join(caught[:2]) if caught else "防守证据未记录具体原因"
        fields["拦截原因 / 规则"] = (
            f"{blocked_summary or '在防守层被有效拦截'}；{reason}"
        )
    return fields


def build_defender_fields(
    *,
    sample: Mapping[str, Any],
    defense: Mapping[str, Any],
    verification: Mapping[str, Any],
    classification: str,
    topic: str,
) -> dict[str, str]:
    trace = derive_round_layer_trace(topic, defense)
    intent = _attack_intent(sample)
    penetrated = classification in {"contained", "full-penetration"}
    if penetrated:
        deepest = trace[-1] if trace else None
        deepest_label = (
            _LAYER_LABELS[int(str(deepest.get("layer")).lstrip("L"))]
            if deepest
            else _LAYER_LABELS[3]
        )
        if classification == "contained":
            position = f"{_LAYER_LABELS[2]} 产生模拟效果（{_LAYER_LABELS[3]} 窗口内恢复）"
        else:
            position = f"{deepest_label} 完整穿透"
        reason = _evidence_text(verification) or _defender_gap_text(
            classification, defense, verification
        )
        return {
            "攻击意图": intent,
            "穿透位置": position,
            "漏洞原因": reason,
        }
    blocked_layer = next(
        (
            layer
            for layer in trace
            if any(
                check.get("status") == "blocked"
                for check in layer.get("checks", [])
                if isinstance(check, Mapping)
            )
        ),
        None,
    )
    if blocked_layer is not None:
        layer_index = int(str(blocked_layer.get("layer")).lstrip("L"))
        position = _LAYER_LABELS[layer_index]
        blocked_check = next(
            (
                check
                for check in blocked_layer.get("checks", [])
                if isinstance(check, Mapping) and check.get("status") == "blocked"
            ),
            None,
        )
        blocked_name = _text((blocked_check or {}).get("name"), limit=60)
        rules = "、".join(
            _text(rule, limit=40) for rule in (blocked_check or {}).get("evidenceIds", [])
        )
        means = blocked_name or "防守规则拦截"
        if rules:
            means += f"（规则：{rules}）"
    else:
        position = "靶标拒绝（live 验证）"
        means = _evidence_text(verification) or "受控靶标明确拒绝执行"
    return {
        "攻击意图": intent,
        "拦截位置": position,
        "拦截手段": means,
    }


# ---------------------------------------------------------------------------
# 记录构建与写入
# ---------------------------------------------------------------------------


def build_round_records(
    *,
    round_number: int,
    topic: str,
    sample: Mapping[str, Any],
    defense: Mapping[str, Any],
    verification: Mapping[str, Any],
    classification: str,
    previous_sample: Mapping[str, Any] | None,
    battle_id: str,
) -> tuple[dict[str, Any], dict[str, Any], float | None, str]:
    """返回 (attacker_entry, defender_entry, similarity, source_type)。"""
    similarity = payload_similarity(sample, previous_sample)
    if similarity is None:
        source_type = "baseline"
    elif similarity >= 0.85:
        source_type = "same-source"
    else:
        source_type = "new-source"
    penetrated = classification in {"contained", "full-penetration"}
    result_label = (
        f"穿透 · {classification}" if penetrated else f"拦截 · {classification}"
    )
    base = {
        "round": round_number,
        "battleId": battle_id,
        "topic": topic,
        "resultLabel": result_label,
        "sourceType": source_type,
        "similarity": similarity,
        "classification": classification,
        "createdAt": _now(),
    }
    attacker_entry = {
        **base,
        "role": "attacker",
        "fields": build_attacker_fields(
            sample=sample,
            defense=defense,
            verification=verification,
            classification=classification,
            similarity=similarity,
            source_type=source_type,
            topic=topic,
        ),
    }
    defender_entry = {
        **base,
        "role": "defender",
        "fields": build_defender_fields(
            sample=sample,
            defense=defense,
            verification=verification,
            classification=classification,
            topic=topic,
        ),
    }
    return attacker_entry, defender_entry, similarity, source_type


def record_round(
    *,
    battle_id: str,
    round_number: int,
    topic: str,
    sample: Mapping[str, Any],
    defense: Mapping[str, Any],
    verification: Mapping[str, Any],
    classification: str,
    previous_sample: Mapping[str, Any] | None,
    cross_enabled: bool,
) -> dict[str, Any]:
    """回合结算钩子：写入一局库（始终）与跨局库（开关开启时）。"""
    attacker_entry, defender_entry, similarity, source_type = build_round_records(
        round_number=round_number,
        topic=topic,
        sample=sample,
        defense=defense,
        verification=verification,
        classification=classification,
        previous_sample=previous_sample,
        battle_id=battle_id,
    )
    with _LOCK:
        document = _load()
        battle_scope = document["battles"].setdefault(
            battle_id,
            {"topic": topic, "crossMemory": bool(cross_enabled), "attacker": [], "defender": []},
        )
        battle_scope["topic"] = topic
        battle_scope["crossMemory"] = bool(cross_enabled)
        battle_scope["updatedAt"] = _now()
        for role, entry in (("attacker", attacker_entry), ("defender", defender_entry)):
            records = battle_scope.setdefault(role, [])
            records.append(entry)
            # 同一回合同角色的重复结算（重试幂等保护）只保留最后一条。
            same_round = [
                item for item in records[:-1] if item.get("round") == round_number
            ]
            for item in same_round:
                records.remove(item)
        if cross_enabled:
            for role, entry in (("attacker", attacker_entry), ("defender", defender_entry)):
                cross_records = document["cross"].setdefault(role, [])
                cross_records.append(entry)
                del cross_records[:-MAX_CROSS_ENTRIES_PER_ROLE]
        # 一局库只保留最近 MAX_BATTLE_SCOPES 个战局，避免无限增长。
        if len(document["battles"]) > MAX_BATTLE_SCOPES:
            ordered = sorted(
                document["battles"].items(),
                key=lambda item: str(item[1].get("updatedAt") or ""),
                reverse=True,
            )
            document["battles"] = dict(ordered[:MAX_BATTLE_SCOPES])
        _save(document)
    return {
        "attacker": attacker_entry,
        "defender": defender_entry,
        "similarity": similarity,
        "sourceType": source_type,
    }


def battle_entries(battle_id: str) -> dict[str, Any]:
    with _LOCK:
        document = _load()
    scope = document["battles"].get(battle_id) or {}
    return {
        "battleId": battle_id,
        "topic": scope.get("topic"),
        "crossMemory": bool(scope.get("crossMemory")),
        "attacker": list(scope.get("attacker") or []),
        "defender": list(scope.get("defender") or []),
    }


def cross_entries() -> dict[str, Any]:
    with _LOCK:
        document = _load()
    attacker = list(document["cross"].get("attacker") or [])
    defender = list(document["cross"].get("defender") or [])
    battle_ids = {str(item.get("battleId")) for item in attacker + defender}
    return {
        "attacker": attacker,
        "defender": defender,
        "battleCount": len(battle_ids),
    }


def clear_cross() -> dict[str, int]:
    """清空跨局记忆（一局库不受影响）。返回各角色清除的条数。"""
    with _LOCK:
        document = _load()
        cleared = {
            "attacker": len(document["cross"].get("attacker") or []),
            "defender": len(document["cross"].get("defender") or []),
        }
        document["cross"] = {"attacker": [], "defender": []}
        _save(document)
    return cleared


def set_battle_flag(battle_id: str, *, enabled: bool) -> bool:
    """同步前端 "跨局记忆" 开关到指定战局（运行中也能改）。"""
    with _LOCK:
        document = _load()
        scope = document["battles"].get(battle_id)
        if scope is None:
            return False
        scope["crossMemory"] = bool(enabled)
        scope["updatedAt"] = _now()
        _save(document)
    return True


def agent_memory(
    *,
    battle_id: str,
    role: Role,
    round_index: int,
    cross_enabled: bool,
) -> list[dict[str, Any]]:
    """下一回合注入智能体上下文的候选记忆（角色隔离）。

    - 第 1 回合：仅跨局记忆开启时返回跨局记录；
    - 第 2 回合起：一局库中本战局此前回合的记录（始终可用）
      + 跨局记录（开启时）。跨局记录排在前（更早的经验）。
    """
    with _LOCK:
        document = _load()
    records: list[dict[str, Any]] = []
    if cross_enabled:
        records.extend(document["cross"].get(role) or [])
    scope = document["battles"].get(battle_id) or {}
    if round_index >= 2:
        records.extend(
            item
            for item in (scope.get(role) or [])
            if isinstance(item, dict) and item.get("round", 0) < round_index
        )
    compact: list[dict[str, Any]] = []
    for item in records[-MAX_AGENT_MEMORY_RECORDS:]:
        fields = item.get("fields")
        compact.append(
            {
                "round": item.get("round"),
                "scope": "cross"
                if item in (document["cross"].get(role) or [])
                else "battle",
                "resultLabel": item.get("resultLabel"),
                "sourceType": item.get("sourceType"),
                "fields": fields if isinstance(fields, dict) else {},
            }
        )
    return compact
