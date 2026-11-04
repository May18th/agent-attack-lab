"""Benchmark the deterministic OWASP text-rule layer against public prompt-injection datasets.

Scope
-----
This script measures ONLY the local, deterministic OWASP-LLM-Top10 text-heuristic
layer (``agent_attack_lab.owasp_rules.classify_owasp_llm_text``). It does NOT call
any model, does NOT run the full Attacker/Defender/Arbiter pipeline, and does NOT
claim to measure the whole platform's end-to-end accuracy.

What it reports
---------------
For each dataset we compute, against the rule layer's "hit / no-hit" decision:

- 检出率 (detection rate / recall on malicious): 恶意样本中被命中 >=1 条规则的比例
- 误报率 (false-positive rate on benign):     良性样本中被命中 >=1 条规则的比例
- 分类分布:                                   各 OWASP 类别 (LLM01..LLM10) 命中次数

Datasets (English, loaded via HF_ENDPOINT mirror when configured):
- deepset/prompt-injections        -> text + label(0/1), has benign + malicious
- Lakera/gandalf_ignore_instructions -> text only, all malicious (test split)

Output
------
Prints a text table and writes ``artifacts/benchmark/owasp_rule_benchmark.json``.

The numbers are REAL and reproducible. If a field is unavailable (e.g. no benign
set in a dataset), it is reported as ``None`` — never fabricated.
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from agent_attack_lab.owasp_rules import classify_owasp_llm_text  # noqa: E402

OUT_DIR = ROOT / "artifacts" / "benchmark"


def load_dataset(spec: str, split: str):
    """Lazy import so the script fails gracefully when `datasets` is absent."""
    from datasets import load_dataset as _load

    return _load(spec, split=split)


def evaluate(texts: list[str], labels: list[int] | None):
    """Run the rule layer over texts; return hit counts and category distribution.

    labels: 1 = malicious, 0 = benign, None = no labels (all treated as malicious).
    """
    n = len(texts)
    hit = 0
    cat_counter: Counter[str] = Counter()
    # per-sample category list (for the detailed dump, optional)
    for t in texts:
        findings = classify_owasp_llm_text(t)
        if findings:
            hit += 1
            for f in findings:
                cat_counter[f["id"]] += 1

    results = {
        "total": n,
        "hit": hit,
        "miss": n - hit,
        "categories": dict(sorted(cat_counter.items())),
    }

    if labels is None:
        results["detection_rate"] = (hit / n) if n else None
        results["false_positive_rate"] = None
    else:
        malicious = [t for t, l in zip(texts, labels) if l == 1]
        benign = [t for t, l in zip(texts, labels) if l == 0]
        tp = sum(1 for t in malicious if classify_owasp_llm_text(t))
        fp = sum(1 for t in benign if classify_owasp_llm_text(t))
        results["malicious_total"] = len(malicious)
        results["benign_total"] = len(benign)
        results["detection_rate"] = (tp / len(malicious)) if malicious else None
        results["false_positive_rate"] = (fp / len(benign)) if benign else None

    return results


def _explicit_vs_implicit(text: str) -> str:
    """粗分样本类型，帮助解释规则层的命中边界（非严谨分类，仅用于报告解读）。

    - explicit: 含"忽略/覆盖之前指令"这类显式指令覆盖字面特征
    - implicit: 角色扮演、语义诱导等无显式指令覆盖的越狱
    - benign: 不含攻击特征
    """
    import re

    t = text.casefold()
    explicit_pat = re.compile(
        r"(ignore|forget|disregard|override)\b.{0,40}(previous|prior|above|system|instruction|instructed)|"
        r"(忽略|忘记|无视|覆盖).{0,20}(之前|先前|系统|指令)"
    )
    if explicit_pat.search(t):
        return "explicit"
    # 无显式特征但含"角色扮演"式诱导，粗判为隐式
    role_pat = re.compile(r"act as|pretend|you are now|you will now|roleplay|jailbreak")
    if role_pat.search(t):
        return "implicit"
    return "benign"


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    report: dict = {"generated_at": None, "datasets": {}}

    # ---- deepset/prompt-injections (has benign + malicious) ----
    print("== deepset/prompt-injections ==")
    try:
        ds = load_dataset("deepset/prompt-injections", split="test")
        texts = [r["text"] for r in ds]
        labels = [int(r["label"]) for r in ds]
        r = evaluate(texts, labels)
        # 附加"显式 vs 隐式"拆分，帮助解读规则层边界
        r["explicit_vs_implicit"] = {}
        for t, l in zip(texts, labels):
            if l != 1:
                continue
            kind = _explicit_vs_implicit(t)
            hit = bool(classify_owasp_llm_text(t))
            bucket = r["explicit_vs_implicit"].setdefault(kind, {"total": 0, "hit": 0})
            bucket["total"] += 1
            if hit:
                bucket["hit"] += 1
        report["datasets"]["deepset/prompt-injections"] = r
        _print_result("deepset/prompt-injections", r)
    except Exception as e:  # noqa: BLE001
        print(f"  SKIP deepset: {type(e).__name__}: {str(e)[:160]}")
        report["datasets"]["deepset/prompt-injections"] = {"error": str(e)[:300]}

    # ---- Lakera/gandalf_ignore_instructions (all malicious) ----
    print("== Lakera/gandalf_ignore_instructions ==")
    try:
        ds = load_dataset("Lakera/gandalf_ignore_instructions", split="test")
        texts = [r["text"] for r in ds]
        r = evaluate(texts, None)
        r["explicit_vs_implicit"] = {}
        for t in texts:
            kind = _explicit_vs_implicit(t)
            hit = bool(classify_owasp_llm_text(t))
            bucket = r["explicit_vs_implicit"].setdefault(kind, {"total": 0, "hit": 0})
            bucket["total"] += 1
            if hit:
                bucket["hit"] += 1
        report["datasets"]["Lakera/gandalf_ignore_instructions"] = r
        _print_result("Lakera/gandalf_ignore_instructions", r)
    except Exception as e:  # noqa: BLE001
        print(f"  SKIP gandalf: {type(e).__name__}: {str(e)[:160]}")
        report["datasets"]["Lakera/gandalf_ignore_instructions"] = {"error": str(e)[:300]}

    from datetime import datetime, timezone

    report["generated_at"] = datetime.now(timezone.utc).isoformat()
    out = OUT_DIR / "owasp_rule_benchmark.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n报告已写入: {out}")
    return 0


def _print_result(name: str, r: dict) -> None:
    dr = r.get("detection_rate")
    fpr = r.get("false_positive_rate")
    dr_s = f"{dr:.1%}" if isinstance(dr, float) else "N/A"
    fpr_s = f"{fpr:.1%}" if isinstance(fpr, float) else "N/A"
    print(f"  总样本 {r['total']} | 命中 {r['hit']} | 未命中 {r['miss']}")
    print(f"  检出率 {dr_s} | 误报率 {fpr_s}")
    if r.get("categories"):
        print(f"  分类分布: {r['categories']}")
    evi = r.get("explicit_vs_implicit")
    if evi:
        for kind, b in evi.items():
            rate = f"{b['hit']}/{b['total']}"
            print(f"    [{kind}] {rate} 命中")


if __name__ == "__main__":
    raise SystemExit(main())
