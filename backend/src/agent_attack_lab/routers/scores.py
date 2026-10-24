"""Scoring reads: one battle's stored snapshot, the cross-battle aggregate, the
leaderboard.

These endpoints never compute a score on the fly. Terminal battles are scored
once and persisted; a battle without a snapshot gets an explicit
``insufficient_evidence`` payload instead of a live estimate that could drift
between two requests.
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from agent_attack_lab import scoring_glue, security, state
from agent_attack_lab.scoring import SCORING_VERSION

router = APIRouter()


@router.get(
    "/battles/{battle_id}/score",
    summary="查看战局内部运行质量评分",
    description="返回战局完成后持久化的可追溯运行评分，不代表攻击成功率或检测准确率；缺少快照时返回证据不足。",
    tags=["评分接口"],
    dependencies=[Depends(security.read_auth_dependency)],
)
def battle_internal_score(battle_id: str) -> dict[str, Any]:
    record = state.battle_store.get(battle_id)
    if record is None:
        raise HTTPException(status_code=404, detail="战局不存在")
    stored = state.battle_store.get_score(battle_id)
    return stored if stored is not None else scoring_glue.insufficient_internal_score()


@router.get(
    "/internal-scores",
    summary="查看近期战局内部运行质量评分",
    description="聚合最近战局的运行质量评分；缺少逐调用事件的历史战局单独标记为证据不足。",
    tags=["评分接口"],
    dependencies=[Depends(security.read_auth_dependency)],
)
def internal_scores(limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
    items = []
    records = state.battle_store.list(limit=limit)
    stored_scores = state.battle_store.list_scores([record["id"] for record in records])
    for record in records:
        score = (
            stored_scores.get(record["id"])
            or scoring_glue.insufficient_internal_score()
        )
        items.append(
            {
                "battleId": record["id"],
                "topic": record["topic"],
                "difficulty": record["difficulty"],
                "status": record["status"],
                "createdAt": record["createdAt"],
                **score,
            }
        )
    attacker_scores = [
        item["attacker"]["score"]
        for item in items
        if isinstance(item["attacker"]["score"], (int, float))
    ]
    defender_scores = [
        item["defender"]["score"]
        for item in items
        if isinstance(item["defender"]["score"], (int, float))
    ]
    return {
        "version": SCORING_VERSION,
        "attacker": {
            "scoredBattleCount": len(attacker_scores),
            "insufficientEvidenceCount": len(items) - len(attacker_scores),
            "averageScore": round(sum(attacker_scores) / len(attacker_scores), 1)
            if attacker_scores
            else None,
        },
        "defender": {
            "scoredBattleCount": len(defender_scores),
            "insufficientEvidenceCount": len(items) - len(defender_scores),
            "averageScore": round(sum(defender_scores) / len(defender_scores), 1)
            if defender_scores
            else None,
        },
        "items": items,
    }


@router.get(
    "/leaderboard",
    summary="查看攻防排行榜",
    description="返回攻击方和防守方的累计得分与对抗轮次。",
    tags=["统计接口"],
    dependencies=[Depends(security.read_auth_dependency)],
)
def leaderboard() -> dict[str, Any]:
    now = time.monotonic()
    if state.leaderboard_cache and now - state.leaderboard_cache[0] < 2:
        return state.leaderboard_cache[1]
    cached = state.redis_cache.get_json("agent-attack-lab:v1:leaderboard")
    if isinstance(cached, dict) and isinstance(cached.get("items"), list):
        state.leaderboard_cache = (now, cached)
        return cached
    attacker_score = defender_score = 0
    rounds = 0
    for record in state.battle_store.list(limit=100000):
        attack_points, defend_points = scoring_glue.role_scores(record)
        attacker_score += attack_points
        defender_score += defend_points
        rounds += len(record["attackerOut"].get("samples", []))
    result = {
        "items": [
            {"agent": "attacker", "score": attacker_score, "rounds": rounds},
            {"agent": "defender", "score": defender_score, "rounds": rounds},
        ],
    }
    state.leaderboard_cache = (now, result)
    state.redis_cache.set_json("agent-attack-lab:v1:leaderboard", result)
    return result
