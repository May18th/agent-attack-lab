"""用户调研问卷的 PDF 报告：鉴权、空数据、内容与统计口径。"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent_attack_lab import config, survey_pdf
from agent_attack_lab.routers import survey as survey_router


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_SURVEY_STORE", str(tmp_path / "responses.jsonl"))
    app = FastAPI()
    app.include_router(survey_router.router)
    return TestClient(app)


@pytest.fixture()
def cjk_font():
    """渲染 PDF 需要中文字体；CI 里装了 fonts-noto-cjk，其他环境没有就跳过。"""
    try:
        survey_pdf.ensure_font()
    except survey_pdf.PdfFontUnavailable:
        pytest.skip("本机无可用中文字体，跳过 PDF 渲染用例")


def _payload(**overrides):
    data = {
        "q1_role": "后端开发工程师",
        "q2_method": "手写提示词逐个试，结果记在笔记里",
        "q2_pain_point": "构造测试样本太耗时",
        "q3_ranking": ["命中证据", "攻击样本", "裁决结果", "战报"],
        "q4_can_judge": "能，证据链清晰",
        "q5_willingness": "敢，有授权就敢用",
        "q5_concern": "担心误报率高",
        "q6_reuse_score": 5,
        "q6_must_fix": "希望支持自定义靶标",
    }
    data.update(overrides)
    return data


def test_pdf_export_requires_auth(client, monkeypatch) -> None:
    monkeypatch.setattr(config, "api_key", "secret-key")
    client.post("/api/survey/submit", json=_payload())

    assert client.get("/api/survey/export.pdf").status_code == 401


def test_pdf_export_returns_real_pdf(client, monkeypatch, cjk_font) -> None:
    monkeypatch.setattr(config, "api_key", "secret-key")
    client.post("/api/survey/submit", json=_payload())
    client.post(
        "/api/survey/submit", json=_payload(q1_role="产品经理", q6_reuse_score=3)
    )

    response = client.get("/api/survey/export.pdf", headers={"x-api-key": "secret-key"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["x-total-count"] == "2"
    assert response.headers["content-disposition"].endswith('survey-report.pdf"')
    # 文件头是 PDF 魔数，且带 EOF 标记，说明是完整文档而不是被截断的字节流。
    body = response.content
    assert body.startswith(b"%PDF-")
    assert b"%%EOF" in body[-2048:]
    assert len(body) > 2000


def test_pdf_export_on_empty_store_still_renders(client, monkeypatch, cjk_font) -> None:
    monkeypatch.setattr(config, "api_key", "secret-key")

    response = client.get("/api/survey/export.pdf", headers={"x-api-key": "secret-key"})

    assert response.status_code == 200
    assert response.headers["x-total-count"] == "0"
    assert response.content.startswith(b"%PDF-")


def test_pdf_export_allows_admin_browser_session(client, monkeypatch, cjk_font) -> None:
    from agent_attack_lab import security

    monkeypatch.setattr(config, "api_key", "")
    monkeypatch.setattr(config, "browser_password", "admin-pass")
    client.post("/api/survey/submit", json=_payload())

    assert client.get("/api/survey/export.pdf").status_code == 401

    client.cookies.set(config.browser_cookie_name, security.issue_browser_session())
    assert client.get("/api/survey/export.pdf").status_code == 200


def test_pdf_export_splits_summary_and_detail(client, monkeypatch, cjk_font) -> None:
    """汇总与明细要能各自单独成文件，文件名也不同，避免材料里两份搞混。"""
    monkeypatch.setattr(config, "api_key", "secret-key")
    for index in range(3):
        client.post("/api/survey/submit", json=_payload(q6_reuse_score=index + 3))

    summary = client.get(
        "/api/survey/export.pdf?part=summary", headers={"x-api-key": "secret-key"}
    )
    detail = client.get(
        "/api/survey/export.pdf?part=detail", headers={"x-api-key": "secret-key"}
    )
    both = client.get("/api/survey/export.pdf", headers={"x-api-key": "secret-key"})

    assert summary.status_code == detail.status_code == both.status_code == 200
    assert summary.headers["content-disposition"].endswith('survey-summary.pdf"')
    assert detail.headers["content-disposition"].endswith('survey-detail.pdf"')
    assert both.headers["content-disposition"].endswith('survey-report.pdf"')
    assert summary.content.startswith(b"%PDF-") and detail.content.startswith(b"%PDF-")
    # 两份内容不同且都不是空壳，合并版页数最多
    assert summary.content != detail.content
    assert len(both.content) > len(summary.content)


def test_pdf_export_rejects_unknown_part(client, monkeypatch) -> None:
    monkeypatch.setattr(config, "api_key", "secret-key")

    response = client.get(
        "/api/survey/export.pdf?part=nope", headers={"x-api-key": "secret-key"}
    )

    assert response.status_code == 422


def test_counts_and_ranking_use_stored_answers() -> None:
    rows = [
        {
            "q1_role": "产品经理",
            "q3_ranking": ["A", "B", "C", "D"],
            "q6_reuse_score": 5,
        },
        {
            "q1_role": "产品经理",
            "q3_ranking": ["B", "A", "C", "D"],
            "q6_reuse_score": 3,
        },
    ]

    assert survey_pdf._counts(rows, "q1_role") == [("产品经理", 2)]
    assert survey_pdf._avg_score(rows) == 4.0
    ranking = survey_pdf._ranking_avg(rows)
    assert [name for name, _ in ranking[:2]] == ["A", "B"]
    assert ranking[0][1] == 1.5


def test_app_font_dir_takes_priority_over_system_paths(tmp_path, monkeypatch) -> None:
    """生产机常常没有任何系统级中文字体，此时必须能用应用自带的 .fonts。"""
    bundled = tmp_path / "NotoSansCJKsc-Regular.otf"
    bundled.write_bytes(b"not-a-real-font")
    monkeypatch.setattr(survey_pdf, "_APP_FONT_DIR", tmp_path)

    bold = tmp_path / "NotoSansSC-Bold.ttf"
    bold.write_bytes(b"not-a-real-font")
    candidates = survey_pdf._font_candidates()

    # 自带字体排在最前，且正文必须避开 Bold（否则整篇都会变粗）。
    assert candidates[0][0] == str(bundled)
    assert all("Bold" not in path for path, _ in candidates[:3])
    # 粗体候选以自带 Bold 开头。
    assert survey_pdf._bold_candidates()[0][0] == str(bold)
    # 非字体文件不参与候选。
    (tmp_path / "readme.txt").write_text("x", encoding="utf-8")
    assert all(not path.endswith(".txt") for path, _ in survey_pdf._font_candidates())


def test_app_font_dir_missing_is_not_an_error(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(survey_pdf, "_APP_FONT_DIR", tmp_path / "nope")
    assert survey_pdf._app_font_candidates() == []
