"""Remove obvious integration/test noise from an exported chat JSONL dataset."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from prepare_finetune_dataset import _validate


EXCLUSION_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("random-topic", re.compile(r"^完全无关的随机主题abc$")),
    ("acceptance-run", re.compile(r"^验收(?:A4复查|[AB])(?:-|$)")),
    ("jury-run", re.compile(r"^评委实测(?:desktop|mobile)$")),
    ("llm-connectivity-test", re.compile(r"^LLM连接自测(?:-|$)")),
    ("public-integration-run", re.compile(r"^公网联调$")),
    ("placeholder-topic", re.compile(r"^general$")),
)


def _topic(example: dict[str, Any]) -> str:
    metadata = example.get("metadata")
    return str(metadata.get("topic", "")).strip() if isinstance(metadata, dict) else ""


def _rule_for(topic: str) -> str | None:
    for name, pattern in EXCLUSION_RULES:
        if pattern.search(topic):
            return name
    return None


def _json_line(example: dict[str, Any]) -> str:
    return json.dumps(example, ensure_ascii=False, separators=(",", ":"))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean(input_dir: Path, output_dir: Path) -> dict[str, Any]:
    files = sorted(input_dir.glob("*.jsonl"))
    if not files:
        raise FileNotFoundError(f"no JSONL files found in {input_dir}")

    excluded_by_rule: Counter[str] = Counter()
    excluded_topics: Counter[str] = Counter()
    kept_by_file: dict[str, list[dict[str, Any]]] = {}
    seen_hashes: set[str] = set()
    before_count = 0
    after_count = 0

    for path in files:
        role = "attacker" if path.name.startswith("attacker_") else "defender"
        kept: list[dict[str, Any]] = []
        for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if not raw.strip():
                continue
            before_count += 1
            try:
                example = json.loads(raw)
                _validate(example, role)
            except (TypeError, ValueError, json.JSONDecodeError) as exc:
                raise ValueError(f"{path.name}:{line_number}: invalid {role} example: {exc}") from exc

            topic = _topic(example)
            rule = _rule_for(topic)
            if rule:
                excluded_by_rule[rule] += 1
                excluded_topics[topic] += 1
                continue

            canonical = _json_line(example)
            digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
            if digest in seen_hashes:
                continue
            seen_hashes.add(digest)
            kept.append(example)
            after_count += 1
        kept_by_file[path.name] = kept

    output_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    hashes: dict[str, str] = {}
    for source_name, examples in kept_by_file.items():
        output_path = output_dir / source_name
        output_path.write_text("".join(_json_line(example) + "\n" for example in examples), encoding="utf-8")
        key = source_name.removesuffix(".jsonl")
        counts[key] = len(examples)
        hashes[source_name] = _sha256(output_path)

    report = {
        "format": "chat-jsonl",
        "source": str(input_dir),
        "cleaningPolicy": "exclude explicit integration, acceptance, placeholder, and unrelated test topics; preserve originals",
        "files": len(files),
        "beforeCount": before_count,
        "afterCount": after_count,
        "removedCount": before_count - after_count,
        "excludedByRule": dict(sorted(excluded_by_rule.items())),
        "excludedTopics": dict(sorted(excluded_topics.items())),
        "counts": counts,
        "sha256": hashes,
    }
    (output_dir / "manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean integration/test noise from finetuning JSONL")
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(clean(args.input_dir, args.output_dir), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
