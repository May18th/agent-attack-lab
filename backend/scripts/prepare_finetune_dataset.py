"""Export completed synthetic battles as provider-neutral fine-tuning JSONL.

The exporter never calls a model or sends data over the network. It reads the
configured battle store, keeps only completed synthetic records, and emits
separate attacker/defender chat datasets plus a manifest with SHA-256 hashes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any, Iterable


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT / "src"))

from agent_attack_lab.storage import BattleStore  # noqa: E402


ATTACK_SYSTEM = (
    "你是授权实验室中的攻击样本设计智能体。只生成静态、合成、不会执行的测试文本，"
    "不访问网络、不调用工具、不攻击真实目标。输出 JSON 对象 {\"samples\":[]}。"
)
DEFENDER_SYSTEM = (
    "你是防守分析智能体。只分析给定的合成样本文本，不执行代码、工具、URL、SQL 或网络请求，"
    "不声称真实目标已验证。输出 JSON 对象 {\"findings\":[]}，evidence 必须是输入 content 中的连续原文。"
)
SAMPLE_FIELDS = ("type", "topic", "severity", "scenario", "objective", "content")
ATTACK_OUTPUT_FIELDS = ("type", "severity", "scenario", "objective", "content")
RULE_CATEGORY = {
    "LAB-PROMPT-001": "LLM01",
    "LAB-TENANT-001": "LLM02",
    "LAB-SQLI-001": "LLM05",
}


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _sample(sample: Any) -> dict[str, Any] | None:
    if not isinstance(sample, dict) or not isinstance(sample.get("content"), str):
        return None
    result = {key: sample.get(key) for key in SAMPLE_FIELDS}
    if not all(isinstance(result.get(key), str) and result[key].strip() for key in SAMPLE_FIELDS):
        return None
    return result


def _assistant_message(value: dict[str, Any]) -> dict[str, str]:
    return {"role": "assistant", "content": _json(value)}


def _user_message(value: dict[str, Any]) -> dict[str, str]:
    return {"role": "user", "content": _json(value)}


def _attacker_example(record: dict[str, Any], sample: dict[str, Any]) -> dict[str, Any]:
    output = {key: sample[key] for key in ATTACK_OUTPUT_FIELDS}
    return {
        "messages": [
            {"role": "system", "content": ATTACK_SYSTEM},
            _user_message({"difficulty": record["difficulty"], "topic": record["topic"]}),
            _assistant_message({"samples": [output]}),
        ],
        "metadata": {"topic": record["topic"], "difficulty": record["difficulty"], "sourceBattle": record["id"]},
    }


def _defender_findings(sample: dict[str, Any], defense: Any) -> list[dict[str, str]]:
    if not isinstance(defense, dict):
        return []
    caught = defense.get("caught")
    if not isinstance(caught, list):
        return []
    risks = defense.get("risks") if isinstance(defense.get("risks"), list) else []
    fixed = defense.get("fixed") if isinstance(defense.get("fixed"), list) else []
    findings: list[dict[str, str]] = []
    for index, item in enumerate(caught):
        if not isinstance(item, dict):
            continue
        category = item.get("owaspCategory") or RULE_CATEGORY.get(str(item.get("ruleId")))
        matched = item.get("matchedText")
        evidence = next(
            (value for value in matched if isinstance(value, str) and value and value in sample["content"]),
            None,
        ) if isinstance(matched, list) else None
        if not isinstance(category, str) or not evidence:
            continue
        risk = risks[index] if index < len(risks) and isinstance(risks[index], dict) else {}
        recommendation = fixed[index] if index < len(fixed) and isinstance(fixed[index], dict) else {}
        findings.append({
            "owaspCategory": category,
            "evidence": evidence,
            "reason": str(item.get("reason") or "依据提交文本中的安全线索进行分类。"),
            "risk": str(risk.get("reason") or "条件性风险；真实目标未验证。"),
            "action": str(recommendation.get("action") or "在隔离且获授权的环境中验证。"),
        })
    return findings


def _defender_example(record: dict[str, Any], sample: dict[str, Any], defense: Any) -> dict[str, Any]:
    return {
        "messages": [
            {"role": "system", "content": DEFENDER_SYSTEM},
            _user_message({"sample": sample}),
            _assistant_message({"findings": _defender_findings(sample, defense)}),
        ],
        "metadata": {"topic": record["topic"], "sourceBattle": record["id"]},
    }


def _key(example: dict[str, Any]) -> str:
    return hashlib.sha256(_json(example["messages"]).encode("utf-8")).hexdigest()


def _unique(examples: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for example in examples:
        key = _key(example)
        if key in seen:
            continue
        seen.add(key)
        result.append(example)
    return result


def _split(examples: list[dict[str, Any]], ratio: float, seed: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not examples or ratio <= 0:
        return examples, []
    groups: dict[str, list[dict[str, Any]]] = {}
    for example in examples:
        metadata = example.get("metadata", {})
        group = f"{metadata.get('topic', '')}|{metadata.get('difficulty', '')}"
        groups.setdefault(group, []).append(example)
    validation: list[dict[str, Any]] = []
    training: list[dict[str, Any]] = []
    for group, values in groups.items():
        digest = hashlib.sha256(f"{seed}:{group}".encode("utf-8")).digest()[0] / 255
        (validation if digest < ratio else training).extend(values)
    if not training and len(validation) > 1:
        training.append(validation.pop())
    if not validation and len(training) > 4:
        validation.append(training.pop())
    return training, validation


def _validate(example: Any, role: str) -> None:
    if not isinstance(example, dict) or not isinstance(example.get("messages"), list):
        raise ValueError(f"{role}: missing messages")
    messages = example["messages"]
    if len(messages) != 3 or [item.get("role") for item in messages] != ["system", "user", "assistant"]:
        raise ValueError(f"{role}: expected system/user/assistant messages")
    try:
        user = json.loads(messages[1]["content"])
        assistant = json.loads(messages[2]["content"])
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{role}: message content is not JSON") from exc
    if role == "attacker" and not isinstance(user.get("topic"), str):
        raise ValueError("attacker: topic is required")
    if role == "attacker" and not isinstance(assistant.get("samples"), list):
        raise ValueError("attacker: samples must be an array")
    if role == "defender":
        sample = user.get("sample")
        if not isinstance(sample, dict) or not isinstance(sample.get("content"), str):
            raise ValueError("defender: sample.content is required")
        findings = assistant.get("findings")
        if not isinstance(findings, list):
            raise ValueError("defender: findings must be an array")
        for finding in findings:
            evidence = finding.get("evidence") if isinstance(finding, dict) else None
            if not isinstance(evidence, str) or evidence not in sample["content"]:
                raise ValueError("defender: evidence must be an exact substring")


def _write(path: Path, examples: list[dict[str, Any]], role: str) -> str:
    for example in examples:
        _validate(example, role)
    path.write_text("".join(_json(example) + "\n" for example in examples), encoding="utf-8")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export(database: str | None, output_dir: Path, validation_ratio: float, seed: str, limit: int) -> dict[str, Any]:
    store = BattleStore(database) if database else BattleStore()
    try:
        total = store.count()
        records = store.list(limit=min(max(limit, 1), total) if limit else max(total, 1), offset=0)
    finally:
        store.close()

    attacker: list[dict[str, Any]] = []
    defender: list[dict[str, Any]] = []
    for record in records:
        if record.get("status") != "completed":
            continue
        samples = record.get("attackerOut", {}).get("samples", [])
        defenses = record.get("defenderOut", [])
        if not isinstance(samples, list):
            continue
        for index, raw_sample in enumerate(samples):
            sample = _sample(raw_sample)
            if sample is None:
                continue
            attacker.append(_attacker_example(record, sample))
            defense = defenses[index] if isinstance(defenses, list) and index < len(defenses) else {}
            defender.append(_defender_example(record, sample, defense))

    attacker = _unique(attacker)
    defender = _unique(defender)
    attacker_train, attacker_validation = _split(attacker, validation_ratio, seed)
    defender_train, defender_validation = _split(defender, validation_ratio, seed)
    output_dir.mkdir(parents=True, exist_ok=True)
    files = {
        "attacker_train": ("attacker_train.jsonl", attacker_train, "attacker"),
        "attacker_validation": ("attacker_validation.jsonl", attacker_validation, "attacker"),
        "defender_train": ("defender_train.jsonl", defender_train, "defender"),
        "defender_validation": ("defender_validation.jsonl", defender_validation, "defender"),
    }
    manifest: dict[str, Any] = {
        "format": "chat-jsonl",
        "syntheticOnly": True,
        "source": "completed battles",
        "validationRatio": validation_ratio,
        "seed": seed,
        "counts": {},
        "sha256": {},
    }
    for name, (filename, examples, role) in files.items():
        path = output_dir / filename
        manifest["counts"][name] = len(examples)
        manifest["sha256"][filename] = _write(path, examples, role)
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Export completed synthetic battles as fine-tuning JSONL")
    parser.add_argument("--database", help="database URL/path; defaults to the backend environment")
    parser.add_argument("--output-dir", type=Path, default=REPOSITORY_ROOT / "artifacts" / "finetune")
    parser.add_argument("--validation-ratio", type=float, default=0.2)
    parser.add_argument("--seed", default="agent-attack-lab")
    parser.add_argument("--limit", type=int, default=0, help="maximum battles to read; 0 means all")
    args = parser.parse_args()
    if not 0 <= args.validation_ratio < 1:
        parser.error("--validation-ratio must be in [0, 1)")
    manifest = export(args.database, args.output_dir, args.validation_ratio, args.seed, args.limit)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
