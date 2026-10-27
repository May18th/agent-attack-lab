"""Structured battle lifecycle events derived from persisted round evidence."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from agent_attack_lab.layer_interceptions import derive_round_layer_trace

AddEvent = Callable[[str, str, dict[str, Any]], None]


def _sample_id(sample: Mapping[str, Any], round_number: int) -> str:
    value = sample.get("testCaseId") or sample.get("sampleId")
    return str(value) if value else f"round-{round_number}"


def emit_attack_stages(
    add_event: AddEvent,
    *,
    round_number: int,
    total_rounds: int,
    difficulty: str,
    topic: str,
    sample: Mapping[str, Any],
    correlation_id: str,
) -> None:
    sample_id = _sample_id(sample, round_number)
    common = {
        "round": round_number,
        "agentRole": "attacker",
        "correlationId": correlation_id,
    }
    stages: tuple[tuple[str, dict[str, Any], str], ...] = (
        (
            "A1",
            {
                "roundLimit": total_rounds,
                "difficulty": difficulty,
                "topic": topic,
            },
            "passed",
        ),
        ("A2", {"sampleId": sample_id}, "passed"),
        (
            "A3",
            {
                "sampleId": sample_id,
                "scenario": sample.get("scenario"),
                "objective": sample.get("objective"),
                "attackDepth": sample.get("attackDepth"),
                "testVariation": sample.get("testVariation"),
            },
            "passed",
        ),
        (
            "A4",
            {
                "sampleId": sample_id,
                "payloadType": sample.get("type") or "synthetic",
                "contentLength": len(str(sample.get("content") or "")),
            },
            "passed",
        ),
        (
            "A5",
            {
                "sampleId": sample_id,
                "validationStatus": (
                    "passed" if str(sample.get("content") or "") else "unresolved"
                ),
            },
            "passed" if str(sample.get("content") or "") else "unresolved",
        ),
        (
            "A6",
            {
                "sampleId": sample_id,
                "sourceType": "unknown",
                "reason": "similarity_metadata_unavailable",
            },
            "unresolved",
        ),
        (
            "A7",
            {
                "sampleId": sample_id,
                "submissionId": f"{correlation_id}-R{round_number}",
                "accepted": True,
            },
            "passed",
        ),
    )
    for stage_id, payload, classification in stages:
        data = {**common, **payload, "stageId": stage_id}
        add_event("attack.stage.started", "running", data)
        add_event(
            "attack.stage.completed",
            "completed" if classification == "passed" else classification,
            {**data, "classification": classification},
        )


def _arbiter_classification(review: Mapping[str, Any]) -> str:
    return {
        "attacker_won": "full-penetration",
        "defender_won": "blocked",
        "undetermined": "unresolved",
    }.get(str(review.get("verdict")), "unresolved")


def emit_defense_and_arbiter_stages(
    add_event: AddEvent,
    *,
    round_number: int,
    topic: str,
    defense: Mapping[str, Any],
    verification: Mapping[str, Any],
    arbiter_review: Mapping[str, Any],
    correlation_id: str,
) -> str:
    common = {
        "round": round_number,
        "agentRole": "defender",
        "correlationId": correlation_id,
    }
    for layer in derive_round_layer_trace(topic, defense):
        layer_data = {
            **common,
            "stageId": layer["layer"],
            "layerIndex": layer["layerIndex"],
            "layer": layer["layer"],
            "layerName": layer["name"],
            "applicableChecks": layer["applicableChecks"],
            "evidenceBasis": layer["basis"],
        }
        add_event("defense.layer.started", "running", layer_data)
        for check in layer["checks"]:
            check_data = {
                **layer_data,
                "stageId": check["stageId"],
                "status": check["status"],
                "evidenceIds": check["evidenceIds"],
            }
            add_event("defense.check.started", "running", check_data)
            add_event(
                "defense.layer.verdict",
                check["status"],
                {**check_data, "classification": check["status"]},
            )
        if layer["confirmedPassed"]:
            add_event(
                "arbiter.layer.confirmed",
                "passed",
                {
                    **layer_data,
                    "agentRole": "arbiter",
                    "classification": "passed",
                    "evidenceIds": layer["applicableChecks"],
                    "confirmedBy": "arbiter",
                },
            )

    classification = _arbiter_classification(arbiter_review)
    verdict_data = {
        "round": round_number,
        "stageId": "ARBITER",
        "agentRole": "arbiter",
        "correlationId": correlation_id,
        "classification": classification,
        "verdict": arbiter_review.get("verdict"),
        "confidence": arbiter_review.get("confidence"),
        "rationale": arbiter_review.get("rationale"),
        "evidence": arbiter_review.get("evidence", []),
        "needsHumanReview": arbiter_review.get("needsHumanReview"),
        "agentSource": arbiter_review.get("agentSource"),
        "verificationMode": verification.get("mode"),
    }
    for key in ("attackSuccess", "defenseSuccess"):
        if isinstance(verification.get(key), bool):
            verdict_data[key] = verification[key]
    add_event("arbiter.verdict", "completed", verdict_data)

    safe_control = defense.get("safeControl")
    if isinstance(safe_control, Mapping):
        evidence = safe_control.get("evidence")
        safe_status = str(safe_control.get("status") or "unresolved")
        if safe_status == "passed" and (not isinstance(evidence, list) or not evidence):
            safe_status = "unresolved"
        safe_data = {
            **common,
            "stageId": "SAFE-CONTROL",
            **dict(safe_control),
            "status": safe_status,
        }
        add_event(
            "defense.safe_control",
            safe_status,
            {**safe_data, "classification": safe_status},
        )

    return classification


def emit_attack_review(
    add_event: AddEvent,
    *,
    round_number: int,
    classification: str,
    arbiter_review: Mapping[str, Any],
    correlation_id: str,
) -> None:
    data = {
        "round": round_number,
        "stageId": "A8",
        "agentRole": "attacker",
        "correlationId": correlation_id,
        "classification": classification,
        "verdict": arbiter_review.get("verdict"),
        "needsHumanReview": arbiter_review.get("needsHumanReview"),
    }
    add_event("attack.stage.started", "running", data)
    add_event("attack.stage.completed", "completed", data)
