"""战局清单 PDF 导出：鉴权、空库、以及渲染入口能产出完整 PDF。"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent_attack_lab import battle_pdf, config, survey_pdf
from agent_attack_lab.routers import battles as battles_router


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(battles_router.router)
    return TestClient(app)


@pytest.fixture()
def cjk_font():
    try:
        survey_pdf.ensure_font()
    except survey_pdf.PdfFontUnavailable:
        pytest.skip("本机无可用中文字体，跳过 PDF 渲染用例")


def test_battles_pdf_requires_auth(client, monkeypatch) -> None:
    # 读接口只在开启读保护（或配了浏览器密码 / Cloudflare Access）时才校验
    monkeypatch.setattr(config, "protect_read_routes", True)
    monkeypatch.setattr(config, "api_key", "secret-key")

    assert client.get("/api/battles/export.pdf").status_code == 401


def test_battles_pdf_on_empty_store_still_renders(
    client, monkeypatch, cjk_font
) -> None:
    monkeypatch.setattr(config, "api_key", "secret-key")

    response = client.get(
        "/api/battles/export.pdf", headers={"x-api-key": "secret-key"}
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"].endswith('battles.pdf"')
    assert response.content.startswith(b"%PDF-")


def test_build_battles_pdf_renders_rows(cjk_font) -> None:
    rows = [
        {
            "id": "battle-1",
            "code": "A-201",
            "topic": "AI 客服被诱导输出用户隐私",
            "createdAt": "2026-10-30T11:22:33",
            "status": "completed",
            "difficulty": "high",
            "verdict": "attacker_won",
        },
        {
            "id": "battle-2",
            "code": "A-202",
            "topic": "越权调用内部工具",
            "createdAt": "2026-10-30T12:05:00",
            "status": "failed",
            "difficulty": "low",
            "verdict": None,
        },
    ]

    payload = battle_pdf.build_battles_pdf(rows, total=37)

    assert payload.startswith(b"%PDF-")
    assert b"%%EOF" in payload[-2048:]
    assert len(payload) > 2000


def test_build_battles_pdf_reports_truncation(cjk_font) -> None:
    """库里比导出的多时，页首要写清"本表列出最近 N 场"，避免看的人以为只有这些。"""
    rows = [
        {
            "id": "b1",
            "code": "A-301",
            "topic": "测试",
            "createdAt": "2026-10-30T10:00:00",
            "status": "completed",
            "difficulty": "mid",
            "verdict": "defender_won",
        }
    ]

    payload = battle_pdf.build_battles_pdf(rows, total=500)

    assert payload.startswith(b"%PDF-")
    assert len(rows) < 500
