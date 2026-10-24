"""Markdown rendering for battle reports.

Pure formatting: the caller supplies the record, its events, the persisted
internal score, the computed attacker/defender scores and an optional LLM
summary. Nothing here touches storage, the network or module-level state, so
it is safe to import from anywhere without creating a cycle.
"""

from __future__ import annotations

from typing import Any


def build_markdown_report(
    record: dict[str, Any],
    events: list[dict[str, Any]],
    internal_score: dict[str, Any],
    scores: tuple[int, int],
    report_summary: dict[str, Any] | None = None,
) -> str:
    attacker_score, defender_score = scores
    lines = [
        f"# 智能体攻防战报：{record['topic']}",
        "",
        f"- 战局编号：`{record['id']}`",
        f"- 难度：{record['difficulty']}",
        f"- 状态：{record['status']}",
        f"- 创建时间：{record['createdAt']}",
        f"- 攻击方得分：{attacker_score}",
        f"- 防守方得分：{defender_score}",
        "",
        "## 内部运行质量评分",
        "",
        f"- 规则版本：`{internal_score['version']}`",
        f"- 口径：{internal_score['message']}",
        *[
            f"- {role_name}：{role_score['score']}/{role_score['maxScore']}"
            if role_score["score"] is not None
            else f"- {role_name}：证据不足（{role_score['message']}）"
            for role_name, role_score in (
                ("攻击方", internal_score["attacker"]),
                ("防守方", internal_score["defender"]),
            )
        ],
        *[
            f"  - {item['label']}：{item['score']}/{item['maxScore']}（{item['basis']}）"
            for role_score in (internal_score["attacker"], internal_score["defender"])
            for item in role_score["categories"]
        ],
        "",
    ]
    if report_summary is not None:
        lines.extend(
            [
                "## LLM 战报总结",
                "",
                str(report_summary.get("summary", "")),
                "",
                f"- 结果来源：{report_summary.get('agentSource', 'unknown')}",
                f"- 需要人工复核：{'是' if report_summary.get('needsHumanReview') else '否'}",
                *[f"- 风险：{item}" for item in report_summary.get("keyRisks", [])],
                *[f"- 证据：`{item}`" for item in report_summary.get("evidence", [])],
                *[
                    f"- 建议：{item}"
                    for item in report_summary.get("recommendations", [])
                ],
                "",
            ]
        )
    lines.extend(["## 对抗过程", ""])
    samples = record["attackerOut"].get("samples", [])
    defenses = record.get("defenderOut", [])
    for index, sample in enumerate(samples, start=1):
        defense = defenses[index - 1] if index - 1 < len(defenses) else {}
        lines.extend(
            [
                f"### 第 {index} 轮：{sample.get('type', 'unknown')} / {sample.get('severity', 'unknown')}",
                f"- 主题：{sample.get('topic', record['topic'])}",
                f"- 攻击内容：{sample.get('content', '')}",
                f"- 发现问题：{', '.join(item.get('reason', '') for item in defense.get('caught', [])) or '无'}",
                f"- 风险：{', '.join(item.get('reason', '') for item in defense.get('risks', [])) or '无'}",
                f"- 修复动作：{', '.join(item.get('action', '') for item in defense.get('fixed', [])) or '无'}",
                "",
            ]
        )
    lines.extend(["## 事件记录", ""])
    for event in events:
        lines.append(f"- `{event['sequence']}` {event['type']}：{event['createdAt']}")
    return "\n".join(lines) + "\n"
