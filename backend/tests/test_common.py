from __future__ import annotations

from agent_attack_lab.agents.common import _summarize_output


def test_summarize_output_falls_back_when_output_is_not_json_serializable() -> None:
    result = _summarize_output({"value": object()})

    assert result == "已完成任务，结果见结构化数据。"


def test_summarize_output_keeps_a_readable_json_summary() -> None:
    result = _summarize_output({"status": "complete"})

    assert result == '已完成任务，结果摘要：{"status": "complete"}'
