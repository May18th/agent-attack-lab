"""无外部模型 Key 环境下跑一局完整战局，留作规则模式证据（清单第 8 项）。

只用标准库 + 项目自身代码；运行前清空所有模型与 ACP 相关环境变量，
确保攻击、防守、裁决三个角色全部走本地规则。
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

BACKEND = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / "src"))

# 清空所有外部依赖，模拟"没有申请任何模型 Key"的部署环境。
for key in list(os.environ):
    if key.startswith(("AGENT_", "LLM_", "OPENAI_", "DASHSCOPE_")):
        os.environ.pop(key, None)
os.environ.setdefault("AGENT_STORE_PATH", ":memory:")
os.environ["AGENT_SURVEY_PATH"] = str(BACKEND.parent / ".rule-mode-demo-survey.jsonl")

from fastapi.testclient import TestClient  # noqa: E402

from agent_attack_lab.service import app  # noqa: E402

TOPIC = "AI 客服被诱导泄露客户手机号与证件号"

client = TestClient(app)
created = client.post(
    "/battles",
    json={"topic": TOPIC, "difficulty": "mid", "rounds": 3},
)
created.raise_for_status()
battle = created.json()
battle_id = battle["id"]

events = client.get(f"/battles/{battle_id}/events", params={"limit": 1000}).json()
rounds = client.get(f"/battles/{battle_id}/rounds").json()

payload = {
    "capturedAt": "2026-10-28T21:45:00+08:00",
    "environment": {
        "modelKeys": "none",
        "note": "所有 AGENT_*/LLM_*/OPENAI_*/DASHSCOPE_* 环境变量在启动前已清空",
        "verifyMode": os.getenv("AGENT_TARGET_VERIFY_MODE", "off"),
    },
    "battle": {
        "id": battle_id,
        "code": battle.get("code"),
        "topic": battle.get("topic"),
        "difficulty": battle.get("difficulty"),
        "rounds": battle.get("rounds"),
        "status": battle.get("status"),
        "verdict": battle.get("verdict"),
    },
    "sources": {
        "attacker": sorted({str(s.get("variantOperator")) for s in battle["attackerOut"]["samples"]}),
        "attackerSource": battle["attackerOut"].get("agentSource"),
        "defenderSources": [d.get("defenderSource") for d in battle.get("defenderOut", [])],
        "arbiterSources": [r.get("arbiterReview", {}).get("agentSource") for r in rounds.get("rounds", [])],
    },
    "samples": [
        {
            "round": s.get("round"),
            "tier": s.get("strengthTier"),
            "score": s.get("strengthScore"),
            "tactic": s.get("tactic"),
            "operator": s.get("variantOperator"),
            "content": s.get("content"),
        }
        for s in battle["attackerOut"]["samples"]
    ],
    "rounds": [
        {
            "round": r.get("round"),
            "status": r.get("status"),
            "defenderSource": r.get("defenderSource"),
            "caught": [c.get("ruleId") for c in r.get("caught") or []],
            "defenderSource": r.get("defenderSource"),
            "verificationStatus": r.get("verificationStatus"),
            "attackSuccess": r.get("attackSuccess"),
            "evidence": r.get("verificationEvidence"),
            "classification": r.get("classification"),
            "scopeNotice": r.get("scopeNotice"),
        }
        for r in rounds.get("rounds", [])
    ],
    "eventTypes": [e.get("type") for e in events],
}

out = BACKEND.parent / "docs" / "evidence" / "raw" / "rule-mode-20261028.json"
out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

print("battle", battle.get("code"), battle.get("status"), battle.get("verdict"))
for item in payload["samples"]:
    print(
        f"R{item['round']} {item['tier']}/{item['score']} {item['tactic']} "
        f"| {item['operator']} | {str(item['content'])[:60]}"
    )
for item in payload["rounds"]:
    print(
        f"D{item['round']} source={item['defenderSource']} caught={item['caught']} "
        f"verification={item['verificationStatus']} success={item['attackSuccess']}"
    )
print("events", len(payload["eventTypes"]))
print("saved", out)
