"""Evidence-gated target verification for battle verdicts.

The current lab has no live target adapter. Simulated verification therefore
only marks known local detections and always carries an explicit simulation
flag; it must not be presented as a real compromise.
"""

from __future__ import annotations

import os
from typing import Any, Literal

VerifyMode = Literal["off", "simulated", "live"]
_SIMULATABLE_RULES = {
    "LAB-SQLI-001",
    "LAB-PROMPT-001",
    "OWASP-LLM01-LLM",
    "OWASP-LLM07-LLM",
}


def _is_simulatable(rule_id: str) -> bool:
    # LLM-backed defenders report OWASP taxonomy ids (``OWASP-LLMxx-LLM``)
    # rather than the local ``LAB-*`` ids, so accept both families.
    return rule_id in _SIMULATABLE_RULES or rule_id.startswith("OWASP-LLM")


def configured_verify_mode() -> VerifyMode:
    value = os.getenv("AGENT_TARGET_VERIFY_MODE", "off").strip().lower()
    return value if value in {"off", "simulated", "live"} else "off"  # type: ignore[return-value]


def verify_round(
    sample: dict[str, Any],
    defense: dict[str, Any],
    *,
    mode: VerifyMode | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    del config  # Reserved for the future real target adapter.
    selected_mode = mode or configured_verify_mode()
    base = {
        "verified": False,
        "mode": selected_mode,
        "simulated": selected_mode == "simulated",
        "targetAssetId": None,
        "evidence": [],
    }
    if selected_mode == "off":
        return {**base, "reason": "verification_disabled"}
    if selected_mode == "live":
        return {**base, "reason": "no_live_adapter"}

    caught = defense.get("caught") if isinstance(defense, dict) else None
    matched = sorted(
        {
            str(item.get("ruleId"))
            for item in (caught if isinstance(caught, list) else [])
            if isinstance(item, dict) and _is_simulatable(str(item.get("ruleId")))
        }
    )
    if not matched:
        return {**base, "reason": "no_simulated_exploit_evidence"}
    evidence = [
        {
            "kind": "simulated_detection",
            "ruleId": rule_id,
            "testCaseId": sample.get("testCaseId"),
            "note": "本地规则命中，仅为模拟验证，不代表真实目标已沦陷",
        }
        for rule_id in matched
    ]
    return {
        **base,
        "verified": True,
        "evidence": evidence,
        "reason": "simulated_rule_match",
    }


def aggregate_verdict(
    mode: VerifyMode,
    verifications: list[dict[str, Any]],
    defenses: list[dict[str, Any]],
) -> str:
    if any(
        item.get("verified") is True and item.get("mode") in {"simulated", "live"}
        for item in verifications
    ):
        return "attacker_won"
    if mode != "off" and any(
        isinstance(defense, dict) and bool(defense.get("caught"))
        for defense in defenses
    ):
        return "defender_won"
    return "undetermined"
