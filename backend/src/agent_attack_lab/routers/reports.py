"""Battle report: the JSON summary and the rendered markdown document.

``/battles/{id}/report`` and ``/reports/{id}`` are the same handler mounted at two
paths (AIP partners read the latter). The LLM summary is cached in
``state.report_summary_cache`` so reopening a battle does not re-ask the model;
the cache key carries the event count, so an appended event invalidates it.
"""

from __future__ import annotations

import time
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse

from agent_attack_lab import scoring_glue, security, state
from agent_attack_lab.agents.reporter import summarize as summarize_report
from agent_attack_lab.reports import build_markdown_report

router = APIRouter()


def _report_summary_key(
    battle_id: str, record: dict[str, Any], events: list[dict[str, Any]]
) -> tuple[str, int, str]:
    """Cache key: a battle's summary only changes when events are appended."""
    return (battle_id, len(events), str(record.get("status") or ""))


def _prune_report_summary_cache(now: float) -> None:
    for key, (expires_at, _summary) in list(state.report_summary_cache.items()):
        if expires_at <= now:
            state.report_summary_cache.pop(key, None)
    while len(state.report_summary_cache) >= state.REPORT_SUMMARY_CACHE_MAX_ENTRIES:
        oldest = min(state.report_summary_cache.items(), key=lambda item: item[1][0])[0]
        state.report_summary_cache.pop(oldest, None)


async def _report_summary_for(
    battle_id: str, record: dict[str, Any], events: list[dict[str, Any]]
) -> dict[str, Any]:
    """Return the LLM report summary, reusing it while the event log is unchanged.

    The summary can cost one model call with retries, and the admin UI reads the
    report whenever a battle is opened, so an unchanged battle must not re-ask.
    """
    now = time.monotonic()
    key = _report_summary_key(battle_id, record, events)
    cached = state.report_summary_cache.get(key)
    if cached is not None and cached[0] > now:
        return cached[1]
    state.report_summary_cache.pop(key, None)
    summary = await summarize_report(record, events)
    _prune_report_summary_cache(now)
    state.report_summary_cache[key] = (
        now + state.REPORT_SUMMARY_CACHE_TTL_SECONDS,
        summary,
    )
    return summary


@router.get(
    "/battles/{battle_id}/report",
    include_in_schema=False,
    dependencies=[Depends(security.read_auth_dependency)],
)
@router.get(
    "/reports/{battle_id}",
    summary="查看或下载战报",
    description="默认返回 JSON；将 format 设置为 markdown 可下载 Markdown 战报。",
    tags=["战报接口"],
    dependencies=[Depends(security.read_auth_dependency)],
)
async def battle_report(
    battle_id: str,
    format: Literal["json", "markdown"] = Query(default="json"),
) -> Any:
    record = state.battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    events = state.battle_store.list_events(battle_id)
    report_summary = await _report_summary_for(battle_id, record, events)
    if format == "markdown":
        stored_internal_score = state.battle_store.get_score(battle_id)
        return PlainTextResponse(
            build_markdown_report(
                record,
                events,
                stored_internal_score
                if stored_internal_score is not None
                else scoring_glue.insufficient_internal_score(),
                scoring_glue.role_scores(record),
                report_summary,
            ),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{battle_id}.md"'},
        )
    attacker_score, defender_score = scoring_glue.role_scores(record)
    stored_internal_score = state.battle_store.get_score(battle_id)
    return {
        "battle": record,
        "events": events,
        "scores": {"attacker": attacker_score, "defender": defender_score},
        "internalScore": stored_internal_score
        if stored_internal_score is not None
        else scoring_glue.insufficient_internal_score(),
        "summary": report_summary,
    }
