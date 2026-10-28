"""Structured battle lifecycle events derived from persisted round evidence."""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Mapping
from math import sqrt
from typing import Any

from agent_attack_lab.layer_interceptions import derive_round_layer_trace

AddEvent = Callable[[str, str, dict[str, Any]], None]


def _sample_id(sample: Mapping[str, Any], round_number: int) -> str:
    value = sample.get("testCaseId") or sample.get("sampleId")
    return str(value) if value else f"round-{round_number}"


def submission_id_for(sample: Mapping[str, Any], round_number: int) -> str:
    content_hash = hashlib.sha256(
        str(sample.get("content") or "").encode("utf-8")
    ).hexdigest()[:16]
    return f"SUB-R{round_number}-{content_hash}"


def _payload_similarity(
    sample: Mapping[str, Any], previous_sample: Mapping[str, Any] | None
) -> float | None:
    """Return cosine similarity from a versioned character n-gram vectorizer.

    A missing previous sample is intentionally represented as ``None``: the
    first round establishes the baseline and must not be classified as either
    same-source or new-source. Character n-grams provide a deterministic local
    vector without calling an external embedding service or transmitting data.
    """
    if not previous_sample:
        return None
    current = str(sample.get("content") or "").strip()
    previous = str(previous_sample.get("content") or "").strip()
    if not current or not previous:
        return None

    def vectorize(value: str) -> dict[str, int]:
        normalized = " ".join(value.casefold().split())
        counts: dict[str, int] = {}
        for size in (2, 3, 4):
            for index in range(max(0, len(normalized) - size + 1)):
                ngram = normalized[index : index + size]
                counts[ngram] = counts.get(ngram, 0) + 1
        return counts

    current_counts = vectorize(current)
    previous_counts = vectorize(previous)
    vocabulary = set(current_counts) | set(previous_counts)
    dot = sum(
        current_counts.get(token, 0) * previous_counts.get(token, 0)
        for token in vocabulary
    )
    current_norm = sqrt(sum(value * value for value in current_counts.values()))
    previous_norm = sqrt(sum(value * value for value in previous_counts.values()))
    if not current_norm or not previous_norm:
        return 0.0
    return round(dot / (current_norm * previous_norm), 6)


def emit_attack_stages(
    add_event: AddEvent,
    *,
    round_number: int,
    total_rounds: int,
    difficulty: str,
    topic: str,
    sample: Mapping[str, Any],
    previous_sample: Mapping[str, Any] | None = None,
    correlation_id: str,
    historical_samples: list[Mapping[str, Any]] | None = None,
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
            "A7",
            {
                "sampleId": sample_id,
                "submissionId": submission_id_for(sample, round_number),
                "accepted": True,
            },
            "passed",
        ),
    )
    for stage_id, payload, classification in stages[:5]:
        data = {**common, **payload, "stageId": stage_id}
        add_event("attack.stage.started", "running", data)
        add_event(
            "attack.stage.completed",
            "completed" if classification == "passed" else classification,
            {**data, "classification": classification},
        )

    previous_similarity = _payload_similarity(sample, previous_sample)
    history = list(historical_samples or [])
    if previous_sample and all(
        _sample_id(candidate, 0) != _sample_id(previous_sample, 0)
        for candidate in history
    ):
        history.append(previous_sample)
    comparisons = [
        (candidate, _payload_similarity(sample, candidate))
        for candidate in history
        if candidate and _sample_id(candidate, 0) != sample_id
    ]
    comparable = [
        (candidate, similarity)
        for candidate, similarity in comparisons
        if similarity is not None
    ]
    nearest_sample, maximum_similarity = (
        max(comparable, key=lambda item: item[1]) if comparable else (None, None)
    )
    sample_has_content = bool(str(sample.get("content") or "").strip())
    source_type = (
        "baseline"
        if not history and sample_has_content
        else "same-source"
        if maximum_similarity is not None and maximum_similarity >= 0.85
        else "new-source"
        if maximum_similarity is not None
        else "unresolved"
    )
    similarity_data = {
        **common,
        "agentRole": "arbiter",
        "stageId": "A6",
        "sampleId": sample_id,
        "similarityThreshold": 0.85,
        "similarity": maximum_similarity,
        "similarityToPrevious": previous_similarity,
        "maxHistoricalSimilarity": maximum_similarity,
        "nearestSampleId": _sample_id(nearest_sample, 0) if nearest_sample else None,
        "similarityModel": "char-ngram-cosine-v1",
        "similarityModelVersion": "1",
        "sourceType": source_type,
        "comparison": "battle-history" if history else "baseline",
        "comparedSampleIds": [
            _sample_id(candidate, 0)
            for candidate, value in comparable
            if value is not None
        ],
    }
    similarity_status = "completed" if source_type != "unresolved" else "unresolved"
    add_event("arbiter.similarity.checked", similarity_status, similarity_data)

    stage_id, payload, classification = stages[5]
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
        "contained": "contained",
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
    review_layer_evidence = arbiter_review.get("layerEvidence")
    trace = derive_round_layer_trace(
        topic,
        defense,
        review_layer_evidence if isinstance(review_layer_evidence, Mapping) else None,
    )
    blocked_check: Mapping[str, Any] | None = None
    for layer in trace:
        layer_data = {
            **common,
            "stageId": layer["layer"],
            "layerIndex": layer["layerIndex"],
            "layer": layer["layer"],
            "layerName": layer["name"],
            "applicableChecks": layer["applicableChecks"],
            "evidenceBasis": layer["basis"],
        }
        add_event(
            "arbiter.layer.started",
            "running",
            {
                **layer_data,
                "agentRole": "arbiter",
                "statement": f"{layer['layer']} 层检测开始。",
            },
        )
        add_event("defense.layer.started", "running", layer_data)
        for check in layer["checks"]:
            if check["status"] == "skipped-by-block":
                continue
            check_data = {
                **layer_data,
                "stageId": check["stageId"],
                "checkName": check["name"],
                "checkDescription": check["description"],
                "status": check["status"],
                "evidenceIds": check["evidenceIds"],
            }
            add_event("defense.check.started", "running", check_data)
            add_event(
                "defense.layer.verdict",
                check["status"],
                {**check_data, "classification": check["status"]},
            )
            if check["status"] == "blocked" and blocked_check is None:
                blocked_check = check
        if layer["confirmedPassed"]:
            add_event(
                "arbiter.layer.confirmed",
                "passed",
                {
                    **layer_data,
                    "agentRole": "arbiter",
                    "classification": "passed",
                    "evidenceIds": layer["evidenceIds"],
                    "confirmedBy": "arbiter",
                },
            )

    all_layers_passed = len(trace) == 4 and all(
        layer["confirmedPassed"] for layer in trace
    )
    arbiter_classification = _arbiter_classification(arbiter_review)
    has_verified_effect = verification.get("attackSuccess") is True
    confirmed_layers = {
        str(layer["layer"]) for layer in trace if layer["confirmedPassed"]
    }
    classification = (
        "blocked"
        if blocked_check is not None
        else "contained"
        if arbiter_classification == "contained"
        and has_verified_effect
        and {"L0", "L1", "L2"}.issubset(confirmed_layers)
        else "full-penetration"
        if arbiter_classification == "full-penetration"
        and has_verified_effect
        and all_layers_passed
        else "unresolved"
    )
    blocked_at = str(blocked_check.get("stageId")) if blocked_check else None
    blocked_name = str(blocked_check.get("name")) if blocked_check else None
    statement = (
        f"样本在“{blocked_at} · {blocked_name}”被有效阻断，判定 blocked。"
        if blocked_at and blocked_name
        else "攻击效果在控制窗口结束后仍存在，判定 full-penetration。"
        if classification == "full-penetration"
        else "L2 已产生效果，且 Arbiter 确认控制窗口内完成隔离恢复，判定 contained。"
        if classification == "contained"
        else "现有证据不足以完成唯一分类，判定 unresolved。"
    )
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
        "blockedAt": blocked_at,
        "blockedCheckName": blocked_name,
        "statement": statement,
    }
    for key in ("attackSuccess", "defenseSuccess"):
        if isinstance(verification.get(key), bool):
            verdict_data[key] = verification[key]
    if isinstance(review_layer_evidence, Mapping):
        verdict_data["layerEvidence"] = dict(review_layer_evidence)
    add_event("arbiter.verdict", "completed", verdict_data)

    return classification


def emit_post_verdict_stages(
    add_event: AddEvent,
    *,
    round_number: int,
    defense: Mapping[str, Any],
    classification: str,
    correlation_id: str,
) -> None:
    """Emit the independent normal-sample control after A8.

    Missing control evidence stays unresolved; the timeline never invents a
    successful normal-sample release merely to complete the visual sequence.
    """
    add_event(
        "arbiter.safe_control",
        "completed",
        {
            "round": round_number,
            "stageId": "SAFE-CONTROL",
            "agentRole": "arbiter",
            "correlationId": correlation_id,
            "classification": classification,
            "statement": "攻击样本最终分类完成，开始独立安全对照测试。",
        },
    )
    safe_control = defense.get("safeControl")
    control_data = dict(safe_control) if isinstance(safe_control, Mapping) else {}
    evidence = control_data.get("evidence")
    safe_status = str(control_data.get("status") or "unresolved")
    if safe_status == "passed" and (not isinstance(evidence, list) or not evidence):
        safe_status = "unresolved"
    add_event(
        "defense.safe_control",
        safe_status,
        {
            "round": round_number,
            "stageId": "D-07",
            "agentRole": "defender",
            "correlationId": correlation_id,
            **control_data,
            "status": safe_status,
            "classification": safe_status,
            "statement": (
                "正常样本已正确放行。"
                if safe_status == "passed"
                else "缺少正常样本放行证据，安全对照结果为 unresolved。"
            ),
        },
    )


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
