"""战局清单的 PDF 导出。

与问卷报告共用排版基建（字体解析、配色、页脚）——这些是通用的 PDF 元件，
真正的报告差异在表格列与文案上。战局数据量比问卷大，所以固定按创建时间倒序取前 N 条，
并在页首写清"共 N 条"，避免导出后看不出截断。
"""

from __future__ import annotations

import io
from datetime import datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from agent_attack_lab.survey_pdf import (
    ACCENT,
    FILL,
    FONT_BOLD,
    FONT_NAME,
    INK,
    RULE,
    PdfFontUnavailable,
    _footer,
    _SectionTitle,
    _styles,
    ensure_font,
)

__all__ = ["MAX_ROWS", "PdfFontUnavailable", "build_battles_pdf"]

MAX_ROWS = 500
EMPTY_CELL = "—"

STATUS_LABELS = {
    "pending": "待开始",
    "running": "进行中",
    "completed": "已完成",
    "failed": "失败",
}
DIFFICULTY_LABELS = {"low": "低", "mid": "中", "high": "高"}
VERDICT_LABELS = {
    "attacker_won": "攻击方胜",
    "defender_won": "防守方胜",
    "undetermined": "未判定",
}


def _cell(value: Any, fallback: str = EMPTY_CELL) -> str:
    text = "" if value is None else str(value).strip()
    return text or fallback


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _table(rows: list[dict[str, Any]]) -> Table:
    head_style = ParagraphStyle(
        "th", fontName=FONT_BOLD, fontSize=8.6, leading=11, textColor=colors.white
    )
    cell_style = ParagraphStyle(
        "td", fontName=FONT_NAME, fontSize=8.4, leading=11.5, textColor=INK
    )
    header = [
        Paragraph("战局", head_style),
        Paragraph("对抗主题", head_style),
        Paragraph("创建时间", head_style),
        Paragraph("状态", head_style),
        Paragraph("难度", head_style),
        Paragraph("裁决", head_style),
    ]
    body = [header]
    for row in rows:
        code = _cell(row.get("code") or row.get("id"))
        raw = _cell(row.get("createdAt"), "")
        stamp = f"{raw[5:10]} {raw[11:16]}" if len(raw) >= 16 else raw
        body.append(
            [
                Paragraph(code, cell_style),
                Paragraph(_clip(_cell(row.get("topic")), 60), cell_style),
                Paragraph(stamp or EMPTY_CELL, cell_style),
                Paragraph(
                    STATUS_LABELS.get(str(row.get("status")), _cell(row.get("status"))),
                    cell_style,
                ),
                Paragraph(
                    DIFFICULTY_LABELS.get(
                        str(row.get("difficulty")), _cell(row.get("difficulty"))
                    ),
                    cell_style,
                ),
                Paragraph(
                    VERDICT_LABELS.get(str(row.get("verdict")), EMPTY_CELL), cell_style
                ),
            ]
        )
    # 合计 174mm：A4 210mm 减左右各 18mm，超出会压到页边距外。
    table = Table(
        body,
        colWidths=[26 * mm, 58 * mm, 24 * mm, 20 * mm, 16 * mm, 30 * mm],
        repeatRows=1,
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, FILL]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("GRID", (0, 0), (-1, -1), 0.4, RULE),
            ]
        )
    )
    return table


def build_battles_pdf(
    rows: list[dict[str, Any]],
    total: int | None = None,
    generated_at: str | None = None,
) -> bytes:
    """把战局列表渲染成 PDF。``total`` 为库里的总数，用于页首标注是否被截断。"""
    ensure_font()
    styles = _styles()
    buffer = io.BytesIO()
    doc = BaseDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=22 * mm,
        title="攻防战局清单",
        author="智能体攻防实验室",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body")
    doc.addPageTemplates([PageTemplate(id="report", frames=[frame], onPage=_footer)])
    width = doc.width
    stamp = generated_at or datetime.now().strftime("%Y-%m-%d %H:%M")
    shown = len(rows)
    library_total = shown if total is None else total
    truncated = library_total > shown

    story: list[Any] = [
        Paragraph("攻防战局清单", styles["title"]),
        Spacer(1, 6),
        Paragraph(
            f"智能体攻防实验室 · 共 {library_total} 场"
            + (f"（本表列出最近 {shown} 场）" if truncated else "")
            + f" · 生成于 {stamp}",
            styles["subtitle"],
        ),
        Spacer(1, 14),
        _SectionTitle("战局列表", width),
        Spacer(1, 6),
    ]

    if not rows:
        story.append(Paragraph("当前没有任何战局记录。", styles["body"]))
    else:
        story += [
            _table(rows),
            Spacer(1, 6),
            Paragraph(
                "按创建时间倒序；标题过长会截断，完整内容见后台对应战局详情。",
                styles["small"],
            ),
        ]
    doc.build(story)
    return buffer.getvalue()
