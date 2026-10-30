"""用户调研问卷的 PDF 报告生成。

与 CSV 导出（``survey.to_csv``）互补：CSV 给机器看，PDF 给人看——
用于比赛/评审材料，所以排版按"报告"而非"表格导出"处理：

- 首页给样本量与关键指标，不让人翻三页才知道 n 是多少；
- 每题用横向条形展示分布，占比直接标在条上；
- 主观题按原话摘录，不做二次转述，避免"用户普遍认为"这类无主语结论；
- 附录逐份列明细，隐去 ``client_ip`` 与 ``user_agent``（对外材料不应带个人痕迹）。

中文字体不随包分发（体积大且许可各异），改为运行时解析：
``AGENT_PDF_FONT`` 指定路径优先，否则按平台常见路径探测（Windows 微软雅黑 /
Linux Noto CJK / macOS 苹方）。都找不到时抛 ``PdfFontUnavailable``，
由路由层转成明确的 503，而不是产出一份全是黑块的 PDF。
"""

from __future__ import annotations

import io
import os
from collections import Counter
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

# 颜色：正文用近黑，强调用低饱和墨绿，避免打印时糊成一片。
INK = colors.HexColor("#1F2937")
MUTED = colors.HexColor("#6B7280")
ACCENT = colors.HexColor("#0F766E")
RULE = colors.HexColor("#E5E7EB")
FILL = colors.HexColor("#F3F4F6")

_FIXED_CANDIDATES: tuple[tuple[str, int], ...] = (
    (r"C:\Windows\Fonts\msyh.ttc", 0),
    (r"C:\Windows\Fonts\msyh.ttf", 0),
    (r"C:\Windows\Fonts\simhei.ttf", 0),
    (r"C:\Windows\Fonts\Deng.ttf", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
    ("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf", 0),
    ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 0),
    ("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", 0),
    ("/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc", 0),
    ("/System/Library/Fonts/PingFang.ttc", 0),
)
_BOLD_CANDIDATES: tuple[tuple[str, int], ...] = (
    (r"C:\Windows\Fonts\msyhbd.ttc", 0),
    (r"C:\Windows\Fonts\msyhbd.ttf", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 0),
    ("/System/Library/Fonts/PingFang.ttc", 0),
)

# 应用自带字体目录：部署脚本会把 Noto Sans CJK 下到这里，release 之间通过软链共享。
# 这样生产机即使没有任何系统级中文字体，也能出中文 PDF。
_APP_FONT_DIR = Path(__file__).resolve().parents[2] / ".fonts"
_FONT_EXTENSIONS = (".ttf", ".ttc", ".otf")
# 名字里带这些片段的字体基本都覆盖简体中文，用于兜底扫描非标准安装路径。
_CJK_FONT_HINTS = (
    "cjk",
    "noto",
    "wqy",
    "hei",
    "song",
    "yahei",
    "msyh",
    "pingfang",
    "deng",
)

FONT_NAME = "SurveyCJK"
FONT_BOLD = "SurveyCJK-Bold"


def _app_font_candidates() -> list[tuple[str, int]]:
    """目录里自带的字体，优先于系统路径使用。

    部署时会把可变字体实例化成 ``NotoSansSC-Regular.ttf`` 与 ``NotoSansSC-Bold.ttf``；
    正文字体必须避开 Bold，也要让静态实例优先于原始可变字体（后者只有默认字重，
    拿来当正文会显得发细）。
    """

    def rank(path: str) -> int:
        name = os.path.basename(path).lower()
        if "bold" in name:
            return 3
        if "[" in name:  # 可变字体原文件
            return 2
        if "regular" in name:
            return 0
        return 1

    if not _APP_FONT_DIR.is_dir():
        return []
    found = [
        str(path)
        for path in _APP_FONT_DIR.iterdir()
        if path.suffix.lower() in _FONT_EXTENSIONS and path.is_file()
    ]
    return [(path, 0) for path in sorted(found, key=lambda item: (rank(item), item))]


def _bold_candidates() -> tuple[tuple[str, int], ...]:
    """粗体优先用自带目录里的 Bold 实例，其次才是系统路径。"""
    bundled = [
        (path, 0)
        for path, _sub in _app_font_candidates()
        if "bold" in os.path.basename(path).lower()
    ]
    return tuple(bundled) + _BOLD_CANDIDATES


def _system_font_candidates() -> list[tuple[str, int]]:
    """在常见字体根目录里按名字找中文字体，兼容非标准安装位置。"""
    roots = ("/usr/share/fonts", "/usr/local/share/fonts", str(Path.home() / ".fonts"))
    found: list[str] = []
    for root in roots:
        if not os.path.isdir(root):
            continue
        for current, _dirs, files in os.walk(root):
            # 目录层级过深没意义，限制一下避免在怪异的挂载点上卡住。
            if current.count(os.sep) - root.count(os.sep) > 3:
                continue
            for name in files:
                lower = name.lower()
                if not lower.endswith(_FONT_EXTENSIONS):
                    continue
                if any(hint in lower for hint in _CJK_FONT_HINTS):
                    found.append(os.path.join(current, name))
    return [(path, 0) for path in sorted(found)]


def _font_candidates() -> tuple[tuple[str, int], ...]:
    """应用自带字体 → 固定路径 → 系统扫描，越靠前越优先。

    Bold 只用于 ``_bold_candidates()``：混进正文候选会让整篇变成粗体。
    """
    ordered: list[tuple[str, int]] = []
    ordered += [
        item
        for item in _app_font_candidates()
        if "bold" not in os.path.basename(item[0]).lower()
    ]
    ordered += list(_FIXED_CANDIDATES)
    ordered += _system_font_candidates()
    seen: set[str] = set()
    unique: list[tuple[str, int]] = []
    for item in ordered:
        if item[0] in seen:
            continue
        seen.add(item[0])
        unique.append(item)
    return tuple(unique)


class PdfFontUnavailable(RuntimeError):
    """找不到可用的中文字体。"""


def _register(name: str, candidates: Iterable[tuple[str, int]]) -> bool:
    for item in candidates:
        # 允许 (path, subfontIndex) 或裸 path 两种写法，写错也不会在 unpack 处崩。
        path, subfont = item if isinstance(item, tuple) else (item, 0)
        if not os.path.exists(path):
            continue
        try:
            kwargs = {"subfontIndex": subfont} if path.lower().endswith(".ttc") else {}
            pdfmetrics.registerFont(TTFont(name, path, **kwargs))
            return True
        except Exception:  # noqa: BLE001, S112 - 候选字体损坏/不支持，静默换下一个
            continue
    return False


def ensure_font() -> None:
    """注册中文字体；只注册一次，失败抛 PdfFontUnavailable。"""
    if FONT_NAME in pdfmetrics.getRegisteredFontNames():
        return
    override = os.getenv("AGENT_PDF_FONT", "").strip()
    if override and os.path.exists(override):
        pdfmetrics.registerFont(TTFont(FONT_NAME, override))
        bold_override = os.getenv("AGENT_PDF_FONT_BOLD", "").strip()
        bold_path = (
            bold_override
            if bold_override and os.path.exists(bold_override)
            else override
        )
        pdfmetrics.registerFont(TTFont(FONT_BOLD, bold_path))
        return
    candidates = _font_candidates()
    if not _register(FONT_NAME, candidates):
        raise PdfFontUnavailable(
            "未找到可用的中文字体：请安装 Noto Sans CJK，把字体放到 backend/.fonts/，"
            "或用 AGENT_PDF_FONT 指定 TTF/TTC 路径"
        )
    if not _register(FONT_BOLD, _bold_candidates()):
        # 没有独立粗体就复用正文同款字体，保证加粗样式不报错，观感损失可接受。
        first = next((path for path, _sub in candidates if os.path.exists(path)), None)
        if first is not None:
            kwargs = {"subfontIndex": 0} if first.lower().endswith(".ttc") else {}
            pdfmetrics.registerFont(TTFont(FONT_BOLD, first, **kwargs))


# ---------------------------------------------------------------- 样式


def _styles() -> dict[str, ParagraphStyle]:
    base = {"fontName": FONT_NAME, "textColor": INK, "alignment": TA_LEFT}
    return {
        "title": ParagraphStyle(
            "title", fontName=FONT_BOLD, fontSize=22, leading=28, textColor=INK
        ),
        "subtitle": ParagraphStyle(
            "subtitle", fontSize=10.5, leading=16, textColor=MUTED, fontName=FONT_NAME
        ),
        "h2": ParagraphStyle(
            "h2",
            fontName=FONT_BOLD,
            fontSize=13.5,
            leading=18,
            textColor=INK,
            spaceBefore=2,
        ),
        "body": ParagraphStyle("body", fontSize=10, leading=15, **base),
        "small": ParagraphStyle(
            "small", fontSize=8.6, leading=12.5, textColor=MUTED, fontName=FONT_NAME
        ),
        "quote": ParagraphStyle("quote", fontSize=9.4, leading=14, **base),
        "kicker": ParagraphStyle(
            "kicker", fontSize=9, leading=13, textColor=ACCENT, fontName=FONT_NAME
        ),
        "finding": ParagraphStyle(
            "finding",
            fontSize=10.2,
            leading=16,
            leftIndent=14,
            firstLineIndent=-14,
            spaceAfter=4,
            **base,
        ),
    }


class _SectionTitle(Flowable):
    """小节标题：文字 + 下方一条细线，比单纯加粗更清晰。"""

    def __init__(self, text: str, width: float) -> None:
        super().__init__()
        self.text = text
        self.width = width
        self.height = 24

    def draw(self) -> None:
        canvas = self.canv
        canvas.setFillColor(INK)
        canvas.setFont(FONT_BOLD, 13.5)
        canvas.drawString(0, 8, self.text)
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.8)
        canvas.line(0, 2, self.width, 2)


class _Bar(Flowable):
    """一条横向条形：标签 + 条 + 数量/占比，单行一个选项。"""

    def __init__(self, label: str, value: int, total: int, width: float) -> None:
        super().__init__()
        self.label = label
        self.value = value
        self.total = total
        self.width = width
        self.height = 19

    def draw(self) -> None:
        canvas = self.canv
        label_w = self.width * 0.38
        bar_w = self.width * 0.46
        ratio = (self.value / self.total) if self.total else 0
        canvas.setFont(FONT_NAME, 9.2)
        canvas.setFillColor(INK)
        canvas.drawString(0, 5, _clip(self.label, 26))
        if self.value <= 0:
            # 0 不要画一条空心轨道——看起来像渲染坏了。用一小段短横表示"没有"。
            canvas.setStrokeColor(RULE)
            canvas.setLineWidth(1.2)
            canvas.line(label_w, 7.5, label_w + 10, 7.5)
            canvas.setFillColor(MUTED)
            canvas.setFont(FONT_NAME, 8.8)
            canvas.drawRightString(self.width, 5, "0")
            return
        canvas.setFillColor(FILL)
        canvas.roundRect(label_w, 3, bar_w, 9, 4.5, stroke=0, fill=1)
        if ratio > 0:
            canvas.setFillColor(ACCENT)
            filled = max(bar_w * ratio, 3)
            canvas.roundRect(label_w, 3, filled, 9, 4.5, stroke=0, fill=1)
        canvas.setFillColor(MUTED)
        canvas.setFont(FONT_NAME, 8.8)
        canvas.drawRightString(self.width, 5, f"{self.value} · {ratio * 100:.0f}%")


def _clip(text: str, limit: int) -> str:
    text = str(text or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


# ---------------------------------------------------------------- 统计


# 团队联调时会往问卷里灌测试提交，这些进报告会污染"原话摘录"，甚至让结论失真。
# 只用**明确的标记词**判定，避免把真实回答（比如"做过压力测试"）误删。
_SELF_TEST_MARKERS = ("自测", "请忽略", "验证提交", "测试数据", "测试提交", "测试样本")
_TEXT_KEYS = ("q2_method", "q2_pain_point", "q4_can_judge", "q5_concern", "q6_must_fix")


def split_self_test(
    rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """把明显的自测提交分出来，返回 (有效, 被排除)。"""
    kept: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    for row in rows:
        blob = " ".join(str(row.get(key) or "") for key in _TEXT_KEYS)
        (dropped if any(mark in blob for mark in _SELF_TEST_MARKERS) else kept).append(
            row
        )
    return kept, dropped


def _counts(rows: list[dict[str, Any]], key: str) -> list[tuple[str, int]]:
    counter = Counter((row.get(key) or "未填") for row in rows)
    return sorted(counter.items(), key=lambda item: (-item[1], str(item[0])))


def _ranking_avg(rows: list[dict[str, Any]]) -> list[tuple[str, float]]:
    """q3 是 4 个候选项的排序，取平均名次（1 = 最看重）。"""
    totals: dict[str, list[int]] = {}
    for row in rows:
        ranking = row.get("q3_ranking")
        if not isinstance(ranking, list):
            continue
        for index, item in enumerate(ranking, start=1):
            totals.setdefault(str(item), []).append(index)
    averaged = [(name, sum(pos) / len(pos)) for name, pos in totals.items()]
    return sorted(averaged, key=lambda item: item[1])


def _score_dist(rows: list[dict[str, Any]]) -> list[tuple[str, int]]:
    dist = Counter()
    for row in rows:
        try:
            score = int(row.get("q6_reuse_score"))
        except TypeError, ValueError:
            continue
        if 1 <= score <= 5:
            dist[score] += 1
    return [(f"{score} 分", dist.get(score, 0)) for score in (5, 4, 3, 2, 1)]


def _avg_score(rows: list[dict[str, Any]]) -> float | None:
    scores = []
    for row in rows:
        try:
            scores.append(int(row.get("q6_reuse_score")))
        except TypeError, ValueError:
            continue
    return sum(scores) / len(scores) if scores else None


def _quotes(
    rows: list[dict[str, Any]], key: str, limit: int = 5
) -> list[tuple[str, str]]:
    picked = []
    for row in rows:
        text = str(row.get(key) or "").strip()
        if len(text) < 4:
            continue
        picked.append((str(row.get("q1_role") or "未填"), text))
        if len(picked) >= limit:
            break
    return picked


def _top(counter_rows: list[tuple[str, int]]) -> tuple[str, int] | None:
    return counter_rows[0] if counter_rows else None


def _is_tie(counter_rows: list[tuple[str, int]]) -> bool:
    """样本小的时候第一名常常并列，此时不能说"以 X 为主"。"""
    return len(counter_rows) > 1 and counter_rows[0][1] == counter_rows[1][1]


def _findings(rows: list[dict[str, Any]]) -> list[str]:
    """首页的「关键结论」：全部由数据直接推出，不写没有分母的形容词。"""
    total = len(rows)
    findings: list[str] = []

    roles = _counts(rows, "q1_role")
    role = _top(roles)
    if role:
        if _is_tie(roles):
            findings.append(
                f"角色分布分散，{len(roles)} 类各 {role[1]} 人，没有单一主导人群。"
            )
        else:
            findings.append(
                f"受访者以「{role[0]}」为主（{role[1]}/{total} 人，{_pct(role[1], total)}）。"
            )

    pains = _counts(rows, "q2_pain_point")
    pain = _top(pains)
    if pain:
        suffix = "（并列最多）" if _is_tie(pains) else ""
        findings.append(
            f"最痛的一步是「{pain[0]}」，{pain[1]}/{total} 人选择{suffix}。"
        )

    avg = _avg_score(rows)
    if avg is not None:
        high = sum(
            1
            for row in rows
            if str(row.get("q6_reuse_score", "")).isdigit()
            and int(row["q6_reuse_score"]) >= 4
        )
        findings.append(
            f"复用意愿平均 {avg:.1f}/5，其中 {high}/{total} 人给了 4 分及以上。"
        )

    ranking = _ranking_avg(rows)
    if ranking:
        findings.append(
            f"四类结果里最看重「{ranking[0][0]}」（平均第 {ranking[0][1]:.2f} 位）。"
        )

    distrust = Counter()
    for row in rows:
        for item in row.get("q4_distrust_areas") or []:
            distrust[str(item)] += 1
    if distrust:
        ranked = sorted(distrust.items(), key=lambda item: (-item[1], item[0]))
        name, count = ranked[0]
        suffix = "（并列）" if len(ranked) > 1 and ranked[0][1] == ranked[1][1] else ""
        findings.append(f"最不敢信的是「{name}」，{count}/{total} 人勾选{suffix}。")

    willing = sum(
        1 for row in rows if str(row.get("q5_willingness", "")).startswith("敢")
    )
    findings.append(
        f"{willing}/{total} 人表示在有授权的前提下敢用（{_pct(willing, total)}）。"
    )
    return findings[:5]


# ---------------------------------------------------------------- 排版


def _kpi_table(rows: list[dict[str, Any]], styles: dict[str, ParagraphStyle]) -> Table:
    avg = _avg_score(rows)
    roles = {row.get("q1_role") for row in rows if row.get("q1_role")}
    willing = sum(
        1 for row in rows if str(row.get("q5_willingness", "")).startswith("敢")
    )
    judgeable = sum(
        1 for row in rows if str(row.get("q4_can_judge", "")).startswith("能")
    )
    cards = [
        ("有效反馈", f"{len(rows)}", "份"),
        ("覆盖角色", f"{len(roles)}", "类"),
        ("平均复用意愿", "—" if avg is None else f"{avg:.1f}", "/ 5"),
        ("愿意在有授权时使用", f"{_pct(willing, len(rows))}", ""),
        ("认为结论可判断", f"{_pct(judgeable, len(rows))}", ""),
    ]
    header = [Paragraph(f"<b>{name}</b>", styles["small"]) for name, _, _ in cards]
    values = [
        Paragraph(
            f'<font size="17" color="#0F766E"><b>{value}</b></font> '
            f'<font size="8.5" color="#6B7280">{unit}</font>',
            styles["body"],
        )
        for _, value, unit in cards
    ]
    table = Table(
        [values, header], colWidths=[(A4[0] - 36 * mm) / len(cards)] * len(cards)
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), FILL),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("TOPPADDING", (0, 0), (-1, 0), 12),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 12),
                ("TOPPADDING", (0, 1), (-1, 1), 2),
                ("LINEBEFORE", (1, 0), (-1, -1), 0.6, colors.white),
            ]
        )
    )
    return table


def _pct(part: int, total: int) -> str:
    return "—" if not total else f"{part / total * 100:.0f}%"


def _detail_table(
    rows: list[dict[str, Any]], styles: dict[str, ParagraphStyle]
) -> Table:
    """明细表：所有单元格都走 Paragraph，否则长角色名会横向溢出压到邻列。"""
    head_style = ParagraphStyle(
        "th", fontName=FONT_BOLD, fontSize=8.6, leading=11, textColor=colors.white
    )
    cell_style = ParagraphStyle(
        "td", fontName=FONT_NAME, fontSize=8.4, leading=11.5, textColor=INK
    )
    header = [
        Paragraph("收取时间", head_style),
        Paragraph("角色", head_style),
        Paragraph("最常用的做法", head_style),
        Paragraph("复用分", head_style),
        Paragraph("最想让我们改的", head_style),
    ]
    body = [header]
    for row in rows:
        raw = str(row.get("received_at", ""))
        # 明细是给人扫读的，年份冗余：统一压成 MM-DD HH:MM，一行放得下。
        stamp = f"{raw[5:10]} {raw[11:16]}" if len(raw) >= 16 else raw[:16]
        body.append(
            [
                Paragraph(stamp, cell_style),
                Paragraph(str(row.get("q1_role") or "—"), cell_style),
                Paragraph(_clip(str(row.get("q2_method") or "—"), 40), cell_style),
                Paragraph(str(row.get("q6_reuse_score") or "—"), cell_style),
                Paragraph(_clip(str(row.get("q6_must_fix") or "—"), 46), cell_style),
            ]
        )
    # 合计 174mm = A4 宽 210mm 减去左右各 18mm 页边距，不能超，否则表格越界。
    table = Table(
        body, colWidths=[24 * mm, 27 * mm, 41 * mm, 13 * mm, 69 * mm], repeatRows=1
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


def _footer(canvas: Any, doc: BaseDocTemplate) -> None:
    canvas.saveState()
    canvas.setFont(FONT_NAME, 8)
    canvas.setFillColor(MUTED)
    # 页脚左侧取文档标题，问卷与战局两类报告共用同一套页脚但标题不同。
    label = getattr(doc, "title", "") or "报告"
    canvas.drawString(18 * mm, 12 * mm, f"智能体攻防实验室 · {label}")
    canvas.drawRightString(A4[0] - 18 * mm, 12 * mm, f"第 {doc.page} 页")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.6)
    canvas.line(18 * mm, 16 * mm, A4[0] - 18 * mm, 16 * mm)
    canvas.restoreState()


def _sample_note(total: int, dropped: int) -> str:
    """分母说明：有排除项时如实写出来，避免读者对不上总数。"""
    base = f"百分比以当前 {total} 份有效样本为分母，样本量不足时请勿外推为总体结论。"
    if dropped:
        return base + f"（另有 {dropped} 份自测/测试提交已排除，未参与任何统计。）"
    return base


def build_survey_pdf(
    rows: list[dict[str, Any]],
    generated_at: str | None = None,
    part: str = "all",
) -> bytes:
    """把问卷记录渲染成 PDF 字节流。

    ``part``：``all`` 完整报告；``summary`` 只要结论与分布（材料正文用）；
    ``detail`` 只要逐份明细（原始记录归档用）。拆开是为了材料排版时能各占一份。
    ``rows`` 为空时也输出一份"尚无数据"的说明页。
    """
    if part not in {"all", "summary", "detail"}:
        raise ValueError(f"unsupported part: {part}")
    # 自测提交不进报告，但在页面上如实注明排除了多少份，口径可追溯。
    rows, dropped_rows = split_self_test(rows)
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
        title={
            "all": "用户调研反馈报告",
            "summary": "用户调研反馈报告（汇总）",
            "detail": "用户调研反馈报告（明细）",
        }[part],
        author="智能体攻防实验室",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body")
    doc.addPageTemplates([PageTemplate(id="report", frames=[frame], onPage=_footer)])
    width = doc.width

    stamp = generated_at or datetime.now().strftime("%Y-%m-%d %H:%M")
    times = sorted(
        str(row.get("received_at", "")) for row in rows if row.get("received_at")
    )
    span = f"{times[0][:10]} 至 {times[-1][:10]}" if times else "—"

    # 汇总 / 明细的区分放在页脚（见上方 doc.title），正文顶部不再压一枚悬浮标签，
    # 这样与之前确认过的样式样例保持一致。
    story: list[Any] = [
        Paragraph("用户调研反馈报告", styles["title"]),
        Spacer(1, 6),
        Paragraph(
            f"智能体攻防实验室 · 样本 {len(rows)} 份 · 收集区间 {span} · 生成于 {stamp}",
            styles["subtitle"],
        ),
        Spacer(1, 14),
    ]

    if not rows:
        if dropped_rows:
            # 全部都是自测提交：要说清楚"有数据但不可用"，不能显示成"没收到问卷"。
            story += [
                Paragraph("目前没有可分析的有效问卷。", styles["h2"]),
                Spacer(1, 8),
                Paragraph(
                    f"已收到 {len(dropped_rows)} 份提交，但全部被判定为自测/测试提交"
                    "（含「自测」「请忽略」「验证提交」等标记），因此不纳入统计。"
                    "请用真实受访者的回答替换后再导出。",
                    styles["body"],
                ),
            ]
        else:
            story += [
                Paragraph("尚未收到任何问卷提交。", styles["h2"]),
                Spacer(1, 8),
                Paragraph(
                    "问卷页位于 <b>/survey</b>，提交后写入 <b>.data/survey/responses.jsonl</b>；"
                    "本报告按当前存储内容生成，为空即表示没有回收数据。",
                    styles["body"],
                ),
            ]
    else:
        show_summary = part in {"all", "summary"}
        show_detail = part in {"all", "detail"}
        numeral = ["一", "二", "三", "四", "五"]
        section_no = 0

        def section(title: str) -> Any:
            nonlocal section_no
            label = (
                f"{numeral[section_no]}、{title}"
                if section_no < len(numeral)
                else title
            )
            section_no += 1
            return _SectionTitle(label, width)

        if show_summary:
            findings = _findings(rows)
            story += [section("关键结论"), Spacer(1, 8)]
            for index, text in enumerate(findings, start=1):
                story.append(
                    Paragraph(
                        f'<font color="#0F766E"><b>{index}</b></font>&nbsp;&nbsp;{text}',
                        styles["finding"],
                    )
                )
            story += [
                Spacer(1, 16),
                section("样本概览"),
                Spacer(1, 8),
                _kpi_table(rows, styles),
                Spacer(1, 4),
                Paragraph(
                    _sample_note(len(rows), len(dropped_rows)),
                    styles["small"],
                ),
                Spacer(1, 16),
                section("分题分布"),
                Spacer(1, 6),
            ]

            blocks: list[tuple[str, list[tuple[str, int]]]] = [
                ("Q1 受访者角色", _counts(rows, "q1_role")),
                ("Q2 目前的测试方式痛在哪", _counts(rows, "q2_pain_point")),
                ("Q4 能否判断结论可信", _counts(rows, "q4_can_judge")),
                ("Q5 有授权时是否敢用", _counts(rows, "q5_willingness")),
                ("Q6 复用意愿打分（1–5）", _score_dist(rows)),
            ]
            for title, items in blocks:
                total = sum(value for _, value in items) or 1
                bars = [_Bar(label, value, total, width) for label, value in items]
                if not bars:
                    story.append(Paragraph(title, styles["body"]))
                    story.append(Spacer(1, 10))
                    continue
                # 整块保持：拆开会让续行失去题目，读者看不出那几行属于哪一问；
                # 代价是页底可能留白，这个取舍比「无标题的孤立行」可接受。
                story.append(
                    KeepTogether(
                        [
                            Paragraph(title, styles["body"]),
                            Spacer(1, 3),
                            *bars,
                            Spacer(1, 10),
                        ]
                    )
                )

            ranking = _ranking_avg(rows)
            if ranking:
                story.append(
                    Paragraph(
                        "Q3 最看重的四件事（按平均名次，1 = 最看重）", styles["body"]
                    )
                )
                story.append(Spacer(1, 3))
                for name, avg in ranking:
                    story.append(
                        Paragraph(f"· {name} —— 平均第 {avg:.2f} 位", styles["quote"])
                    )
                story.append(Spacer(1, 10))

            quotes = [
                ("Q2 他们现在怎么做", _quotes(rows, "q2_method", 4)),
                ("Q5 他们的顾虑", _quotes(rows, "q5_concern", 4)),
                ("Q6 必须改的地方", _quotes(rows, "q6_must_fix", 4)),
            ]
            story += [Spacer(1, 4), section("原话摘录"), Spacer(1, 6)]
            for title, items in quotes:
                if not items:
                    continue
                story.append(Paragraph(title, styles["body"]))
                for role, text in items:
                    story.append(
                        Paragraph(
                            f'<font color="#6B7280">［{role}］</font> {text}',
                            styles["quote"],
                        )
                    )
                story.append(Spacer(1, 8))

        if show_detail:
            detail = [
                section("明细"),
                Spacer(1, 6),
                Paragraph(
                    "逐份列出关键字段；IP 与浏览器标识不进入报告。", styles["small"]
                ),
                Spacer(1, 6),
                _detail_table(rows, styles),
            ]
            if part == "detail":
                # 单独的明细文件：标题紧接着表格，不必再空一行分节。
                story += [Spacer(1, 6), *detail]
            elif len(rows) <= 15:
                # 完整报告里行数不多：本页放得下就接在后面，放不下整体移到下一页。
                story += [Spacer(1, 14), KeepTogether(detail)]
            else:
                story += [PageBreak(), *detail]

    doc.build(story)
    return buffer.getvalue()
