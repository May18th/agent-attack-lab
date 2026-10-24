from __future__ import annotations

import asyncio

from agent_attack_lab.agents import attacker, defender
from agent_attack_lab.agents.knowledge import (
    build_attacker_knowledge,
    build_defender_knowledge,
)


def test_attacker_knowledge_projection_excludes_defender_fields_and_unrelated_topics() -> None:
    result = build_attacker_knowledge(
        [
            {
                "id": "sample-1",
                "topic": "支付越权",
                "content": "合成支付订单样本",
                "source": "内部",
                "condition": "hidden defender rule",
                "action": "拦截",
            },
            {"id": "sample-2", "topic": "文件上传", "content": "另一个主题"},
        ],
        topic="支付越权",
    )

    assert result == {
        "role": "attacker",
        "records": [{"id": "sample-1", "topic": "支付越权", "content": "合成支付订单样本"}],
    }


def test_defender_knowledge_projection_excludes_attacker_sample_content() -> None:
    result = build_defender_knowledge(
        [
            {
                "id": "rule-1",
                "name": "订单越权",
                "condition": "tenant_id 不一致",
                "action": "拦截",
                "content": "attacker-only sample",
                "topic": "支付越权",
            }
        ],
        topic="支付越权",
    )

    assert result == {
        "role": "defender",
        "records": [{"id": "rule-1", "name": "订单越权", "condition": "tenant_id 不一致", "action": "拦截"}],
    }


def test_topic_scoped_knowledge_does_not_match_when_sample_topic_is_missing() -> None:
    result = build_defender_knowledge(
        [{"id": "rule-1", "name": "Payment", "condition": "card owner check", "topic": "支付"}],
        topic="",
    )

    assert result == {"role": "defender", "records": []}


def test_prompt_knowledge_is_bounded_by_record_count_and_text_length() -> None:
    result = build_attacker_knowledge(
        [
            {"id": f"sample-{index}", "content": "x" * 1000}
            for index in range(12)
        ],
        topic="支付",
    )

    assert len(result["records"]) == 8
    assert all(len(record["content"]) == 500 for record in result["records"])


def test_attacker_prompt_receives_only_attacker_knowledge(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_complete(_system_prompt, user_payload):
        captured.update(user_payload)
        return {
            "samples": [{
                "type": "violation",
                "severity": "low",
                "scenario": "payment",
                "objective": "check",
                "content": "synthetic payment sample",
            }]
        }

    monkeypatch.setattr(attacker, "is_configured", lambda: True)
    monkeypatch.setattr(attacker, "complete_json", fake_complete)
    result = asyncio.run(attacker.process({
        "topic": "支付越权",
        "difficulty": "low",
        "rounds": 1,
        "_knowledgeContext": {
            "role": "attacker",
            "records": [{
                "id": "sample-1",
                "topic": "支付越权",
                "content": "合成样本",
                "condition": "must not reach attacker",
            }],
        },
    }))

    assert result["agentMode"] == "llm"
    assert captured["knowledgeContext"] == {
        "role": "attacker",
        "records": [{"id": "sample-1", "topic": "支付越权", "content": "合成样本"}],
    }


def test_defender_prompt_ignores_forged_attacker_knowledge(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_complete(_system_prompt, user_payload):
        captured.update(user_payload)
        return {"findings": []}

    monkeypatch.setattr(defender, "is_configured", lambda: True)
    monkeypatch.setattr(defender, "complete_json", fake_complete)
    result = asyncio.run(defender.process({
        "sample": {"content": "ordinary safe text"},
        "_knowledgeContext": {
            "role": "attacker",
            "records": [{"id": "sample-1", "content": "hidden attacker sample"}],
        },
    }))

    assert result["agentMode"] == "llm"
    assert "knowledgeContext" not in captured
