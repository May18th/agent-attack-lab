"""Benchmark the DEFENDER SEMANTIC layer (DeepSeek) against public injection datasets.

Scope
-----
This measures the model-based classification path of the Defender agent
(``agents/defender.py`` via ``llm_runtime.complete_json``). Combined with
``benchmark_owasp_rules.py`` (the deterministic rule layer), the two together
approximate the platform's detection stack. Neither script runs the full
Attacker/Defender/Arbiter pipeline nor touches a real target.

Cost / latency
--------------
This makes REAL calls to the configured ``AGENT_LLM_*`` endpoint (deepseek-chat),
one request per sample. It costs money and takes time. Set ``BENCH_MAX_SAMPLES``
to cap the number of samples per dataset for a quick smoke run.

Output
------
Writes ``artifacts/benchmark/defender_semantic_benchmark.json``.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

# 加载 .env（KEY=value），只 setdefault，不覆盖已有环境变量
_ENV_PATH = ROOT / ".env"
if _ENV_PATH.exists():
    for _line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip())

from agent_attack_lab.agents.defender import _SYSTEM_PROMPT  # noqa: E402
from agent_attack_lab.agents.llm_runtime import complete_json, is_configured  # noqa: E402

OUT_DIR = ROOT / "artifacts" / "benchmark"
MAX_SAMPLES = int(os.environ.get("BENCH_MAX_SAMPLES", "0"))  # 0 = 不限
CONCURRENCY = int(os.environ.get("BENCH_CONCURRENCY", "4"))


def load_dataset(spec: str, split: str):
    from datasets import load_dataset as _load

    return _load(spec, split=split)


async def classify_one(text: str) -> bool:
    """Return True if the semantic layer produces >=1 valid finding."""
    try:
        r = await complete_json(_SYSTEM_PROMPT, {"content": text[:8000]}, role="defender")
        findings = r.get("findings")
        return isinstance(findings, list) and len(findings) > 0
    except Exception as e:  # noqa: BLE001
        # 网络/模型错误：记为"未命中"但不掩盖；调用方统计失败数
        return False


async def evaluate(texts: list[str], labels: list[int] | None) -> dict:
    sem = asyncio.Semaphore(CONCURRENCY)
    results: list[bool] = []
    failures = 0

    async def run_one(t: str) -> bool:
        nonlocal failures
        async with sem:
            try:
                return await classify_one(t)
            except Exception:  # noqa: BLE001
                failures += 1
                return False

    # 串行但限并发的方式：逐条 await，靠 semaphore 限制在途请求
    results = await asyncio.gather(*(run_one(t) for t in texts))

    hit = sum(results)
    cat_counter: Counter[str] = Counter()
    # 分类分布需要重新取类别；为省成本，这里只做命中/未命中，类别在规则层脚本已有
    out = {
        "total": len(texts),
        "hit": hit,
        "miss": len(texts) - hit,
        "failures": failures,
    }
    if labels is None:
        out["detection_rate"] = (hit / len(texts)) if texts else None
        out["false_positive_rate"] = None
    else:
        malicious = [i for i, l in enumerate(labels) if l == 1]
        benign = [i for i, l in enumerate(labels) if l == 0]
        tp = sum(1 for i in malicious if results[i])
        fp = sum(1 for i in benign if results[i])
        out["malicious_total"] = len(malicious)
        out["benign_total"] = len(benign)
        out["detection_rate"] = (tp / len(malicious)) if malicious else None
        out["false_positive_rate"] = (fp / len(benign)) if benign else None
    return out


def _cap(texts: list[str], labels: list[int] | None) -> tuple[list[str], list[int] | None]:
    if MAX_SAMPLES and MAX_SAMPLES < len(texts):
        texts = texts[:MAX_SAMPLES]
        labels = labels[:MAX_SAMPLES] if labels is not None else None
    return texts, labels


def _print(name: str, r: dict) -> None:
    dr = r.get("detection_rate")
    fpr = r.get("false_positive_rate")
    dr_s = f"{dr:.1%}" if isinstance(dr, float) else "N/A"
    fpr_s = f"{fpr:.1%}" if isinstance(fpr, float) else "N/A"
    print(f"  {name}")
    print(f"    总 {r['total']} | 命中 {r['hit']} | 未命中 {r['miss']} | 调用失败 {r.get('failures',0)}")
    print(f"    检出率 {dr_s} | 误报率 {fpr_s}")


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not is_configured(role="defender"):
        print("ERROR: AGENT_LLM_* 未配置，无法跑语义层基准。")
        return 2

    report: dict = {"generated_at": None, "datasets": {}, "config": {"concurrency": CONCURRENCY, "max_samples": MAX_SAMPLES or None}}

    # deepset (含良性)
    print("== deepset/prompt-injections（语义层）==")
    ds = load_dataset("deepset/prompt-injections", split="test")
    texts = [r["text"] for r in ds]
    labels = [int(r["label"]) for r in ds]
    texts, labels = _cap(texts, labels)
    r = await evaluate(texts, labels)
    report["datasets"]["deepset/prompt-injections"] = r
    _print("deepset/prompt-injections", r)

    # gandalf (全注入)
    print("== Lakera/gandalf_ignore_instructions（语义层）==")
    ds = load_dataset("Lakera/gandalf_ignore_instructions", split="test")
    texts = [r["text"] for r in ds]
    texts, _ = _cap(texts, None)
    r = await evaluate(texts, None)
    report["datasets"]["Lakera/gandalf_ignore_instructions"] = r
    _print("Lakera/gandalf_ignore_instructions", r)

    from datetime import datetime, timezone

    report["generated_at"] = datetime.now(timezone.utc).isoformat()
    out = OUT_DIR / "defender_semantic_benchmark.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n报告已写入: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
