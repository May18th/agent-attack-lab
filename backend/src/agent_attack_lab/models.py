"""Request and response models for the battle service.

Kept in their own module so the routers (S7) can import them without going
back through ``service``: ``response_model=`` and parameter annotations are
evaluated at import time, so a router -> service import would be circular.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class JsonRpcRequest(BaseModel):
    jsonrpc: Literal["2.0"]
    method: str
    params: dict[str, Any] | None = None
    id: str | int | None = None


class BattleRequest(BaseModel):
    difficulty: Literal["low", "mid", "high"] = "low"
    topic: str = Field(default="general", min_length=1, max_length=200)
    rounds: int = Field(default=3, ge=1, le=10)

    @field_validator("topic")
    @classmethod
    def validate_topic(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("topic 不能为空")
        return value


class BrowserLoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class AdminSampleRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=8000)
    source: str = Field(default="管理员录入", min_length=1, max_length=200)


class AdminRuleRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    condition: str = Field(min_length=1, max_length=2000)
    action: Literal["拦截", "放行"] = "拦截"


class RuleCandidateRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=200)
    reviewDecision: Literal["true_positive"]
    sampleContent: str = Field(min_length=1, max_length=8000)
    reviewedEvidence: str = Field(min_length=5, max_length=500)
    reviewerRationale: str = Field(min_length=1, max_length=800)

    @field_validator("reviewedEvidence")
    @classmethod
    def reviewed_evidence_must_be_from_sample(cls, value: str, info: Any) -> str:
        sample = info.data.get("sampleContent", "")
        if value not in sample:
            raise ValueError("reviewedEvidence 必须是 sampleContent 中的原文")
        return value


class BattleRecord(BaseModel):
    id: str
    code: str | None = None
    difficulty: Literal["low", "mid", "high"]
    topic: str
    status: Literal["pending", "running", "completed", "failed"]
    rounds: int = 3
    verdict: Literal["attacker_won", "defender_won", "undetermined"] | None = None
    createdAt: str
    attackerOut: dict[str, Any]
    defenderOut: list[dict[str, Any]]
    stats: dict[str, int] | None = None


class BattleEvent(BaseModel):
    id: str
    battleId: str
    sequence: int
    type: str
    status: str
    createdAt: str
    data: dict[str, Any] = Field(default_factory=dict)
