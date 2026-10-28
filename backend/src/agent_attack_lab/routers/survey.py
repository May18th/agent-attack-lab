"""用户调研问卷：页面托管、提交、导出。

页面由本服务托管在 ``/survey``，与提交接口同源，避免 file:// 打开时的跨域问题。
提交接口公开（问卷要发给人填），但有速率限制与字段长度约束；
读取与导出接口要求后台身份：浏览器登录会话或 ``x-api-key`` 二者其一。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from pydantic import BaseModel, Field

from agent_attack_lab import security, survey

router = APIRouter()

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
_SURVEY_PAGE = _STATIC_DIR / "survey.html"

Role = Literal[
    "安全研究员 / 红队人员",
    "产品经理",
    "后端开发工程师",
    "AI / LLM 应用开发",
    "学生 / 研究者",
    "其他",
]
PainPoint = Literal[
    "构造测试样本太耗时",
    "跑完看不到明确证据",
    "结果难以复现 / 对账",
    "缺乏标准化流程",
    "没做过这类自查",
    "其他",
]
CanJudge = Literal[
    "能，证据链清晰", "部分能，有些地方看不懂", "不能，缺乏判断依据", "还没仔细看过"
]
Willingness = Literal[
    "敢，有授权就敢用", "有条件敢用（需补充验证）", "不敢，只能当参考", "完全不会用"
]


class SurveySubmission(BaseModel):
    """一次问卷提交，字段与静态页 ``payload`` 一一对应。"""

    q1_role: Role
    q2_method: str = Field(default="", max_length=2000)
    q2_pain_point: PainPoint
    q2_pain_other: str | None = Field(default=None, max_length=1000)
    q3_ranking: list[str] = Field(min_length=4, max_length=4)
    q4_can_judge: CanJudge
    q4_distrust_areas: list[str] | None = None
    q4_distrust_other: str | None = Field(default=None, max_length=1000)
    q5_willingness: Willingness
    q5_concern: str = Field(default="", max_length=2000)
    q6_reuse_score: int = Field(ge=1, le=5)
    q6_must_fix: str = Field(default="", max_length=2000)
    q6_callback: Literal["愿意", "不愿意"] | None = None


@router.get("/survey", response_class=HTMLResponse, include_in_schema=False)
def survey_page() -> HTMLResponse:
    if not _SURVEY_PAGE.exists():
        raise HTTPException(status_code=404, detail="问卷页未部署")
    return HTMLResponse(
        _SURVEY_PAGE.read_text(encoding="utf-8"),
        headers={"Cache-Control": "no-store"},
    )


@router.post(
    "/api/survey/submit",
    dependencies=[Depends(security.rate_limit_dependency)],
)
def submit_survey(payload: SurveySubmission, request: Request) -> dict[str, Any]:
    record = survey.append_response(
        payload.model_dump(),
        {
            "client_ip": security.browser_client_ip(request),
            "user_agent": request.headers.get("user-agent", "")[:300],
        },
    )
    return {"success": True, "id": record["id"]}


@router.get(
    "/api/survey/responses",
    dependencies=[Depends(security.check_browser_or_api_auth)],
)
def list_survey_responses() -> dict[str, Any]:
    rows = survey.load_all()
    return {"count": len(rows), "items": rows}


@router.get(
    "/api/survey/export.csv",
    dependencies=[Depends(security.check_browser_or_api_auth)],
)
def export_survey_csv() -> PlainTextResponse:
    rows = survey.load_all()
    return PlainTextResponse(
        survey.to_csv(rows),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="survey-responses.csv"',
            # 后台导出按钮用它显示份数，不必再拉一次全量数据。
            "X-Total-Count": str(len(rows)),
            "Cache-Control": "no-store",
        },
    )
