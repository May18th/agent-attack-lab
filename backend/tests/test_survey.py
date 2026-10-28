"""用户调研问卷：提交落盘、字段校验、导出鉴权。"""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent_attack_lab import config, survey
from agent_attack_lab.routers import survey as survey_router


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_SURVEY_STORE", str(tmp_path / "responses.jsonl"))
    app = FastAPI()
    app.include_router(survey_router.router)
    return TestClient(app)


def _payload(**overrides):
    data = {
        "q1_role": "安全研究员 / 红队人员",
        "q2_method": "手工构造提示词后人工看回复",
        "q2_pain_point": "跑完看不到明确证据",
        "q2_pain_other": None,
        "q3_ranking": ["命中证据", "攻击样本", "裁决结果", "战报"],
        "q4_can_judge": "部分能，有些地方看不懂",
        "q4_distrust_areas": ["Arbiter 裁决标准"],
        "q4_distrust_other": None,
        "q5_willingness": "有条件敢用（需补充验证）",
        "q5_concern": "担心样本误伤真实业务",
        "q6_reuse_score": 4,
        "q6_must_fix": "希望增加真实目标验证开关",
    }
    data.update(overrides)
    return data


def test_submit_persists_one_line(client, tmp_path) -> None:
    response = client.post("/api/survey/submit", json=_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["id"]

    path = tmp_path / "responses.jsonl"
    lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line]
    assert len(lines) == 1
    stored = json.loads(lines[0])
    assert stored["q1_role"] == "安全研究员 / 红队人员"
    assert stored["q3_ranking"][0] == "命中证据"
    assert stored["received_at"]
    assert stored["user_agent"] == "testclient"


def test_submit_rejects_unknown_role(client) -> None:
    response = client.post("/api/survey/submit", json=_payload(q1_role="随便填的"))
    assert response.status_code == 422


def test_submit_rejects_short_ranking(client) -> None:
    response = client.post("/api/survey/submit", json=_payload(q3_ranking=["攻击样本"]))
    assert response.status_code == 422


def test_responses_require_api_key(client, monkeypatch) -> None:
    monkeypatch.setattr(config, "api_key", "secret-key")
    assert client.get("/api/survey/responses").status_code == 401

    client.post("/api/survey/submit", json=_payload())
    response = client.get("/api/survey/responses", headers={"x-api-key": "secret-key"})
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_csv_export_has_header_and_rows(client, monkeypatch) -> None:
    monkeypatch.setattr(config, "api_key", "secret-key")
    client.post("/api/survey/submit", json=_payload())

    response = client.get("/api/survey/export.csv", headers={"x-api-key": "secret-key"})
    assert response.status_code == 200
    text = response.text
    assert text.lstrip("\ufeff").startswith("id,received_at,client_ip,user_agent")
    assert "命中证据 > 攻击样本 > 裁决结果 > 战报" in text


def test_load_all_skips_broken_lines(tmp_path, monkeypatch) -> None:
    path = tmp_path / "responses.jsonl"
    path.write_text('{"id":"a"}\nnot-json\n{"id":"b"}\n', encoding="utf-8")
    monkeypatch.setenv("AGENT_SURVEY_STORE", str(path))
    rows = survey.load_all()
    assert [row["id"] for row in rows] == ["a", "b"]


def _option_values(field: str) -> list[str]:
    """从问卷页里取某个选项组的全部 input value。"""
    import re

    html = survey_router._SURVEY_PAGE.read_text(encoding="utf-8")
    for block in re.split(r'<div class="options"', html)[1:]:
        m = re.search(r'data-field="([^"]+)"', block[:160])
        if not m or m.group(1) != field:
            continue
        end = block.find("</div>")
        seg = block[:end] if end > 0 else block
        return re.findall(r'<input[^>]*value="([^"]*)"', seg)
    return []


@pytest.mark.parametrize(
    ("field", "enum"),
    [
        ("q1_role", survey_router.Role),
        ("q2_pain_point", survey_router.PainPoint),
        ("q4_can_judge", survey_router.CanJudge),
        ("q5_willingness", survey_router.Willingness),
    ],
)
def test_page_options_match_backend_enum(field, enum) -> None:
    """页面选项值必须与后端枚举逐字一致。

    不一致时前端提交必然 422，而且页面上看不出来：用户会把不可提交
    误判成"点了没反应"。这里把两者锁死，改文案时会被这条测试拦住。
    """
    from typing import get_args

    allowed = set(get_args(enum))
    values = _option_values(field)
    assert values, f"{field} 在问卷页里找不到选项"
    mismatched = [v for v in values if v not in allowed]
    assert not mismatched, (
        f"{field} 的选项值与后端不一致: {mismatched}；后端允许: {sorted(allowed)}"
    )


def test_page_ranking_matches_backend(client) -> None:
    """排序题默认项必须能被后端接受，避免提交时才发现问题。"""
    import re

    html = survey_router._SURVEY_PAGE.read_text(encoding="utf-8")
    items = re.findall(r'<div class="rank-item"[^>]*data-value="([^"]*)"', html)
    assert len(items) == 4, items
    resp = client.post("/api/survey/submit", json=_payload(q3_ranking=items))
    assert resp.status_code == 200, resp.text
