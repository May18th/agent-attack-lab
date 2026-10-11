import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from clean_finetune_dataset import clean


def _example(topic: str, role: str, source_battle: str) -> dict:
    if role == "attacker":
        messages = [
            {"role": "system", "content": "system"},
            {"role": "user", "content": json.dumps({"topic": topic, "difficulty": "low"})},
            {"role": "assistant", "content": json.dumps({"samples": [{"content": "synthetic", "severity": "low", "type": "defect"}]} )},
        ]
    else:
        content = "synthetic evidence"
        messages = [
            {"role": "system", "content": "system"},
            {"role": "user", "content": json.dumps({"sample": {"topic": topic, "content": content}})},
            {"role": "assistant", "content": json.dumps({"findings": [{"evidence": "evidence"}]})},
        ]
    return {"messages": messages, "metadata": {"topic": topic, "sourceBattle": source_battle}}


def test_clean_removes_noise_and_preserves_valid_topics(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "clean"
    source.mkdir()
    rows = [
        _example("验收A-支付接口越权", "attacker", "battle-a"),
        _example("通用安全测试", "attacker", "battle-b"),
    ]
    (source / "attacker_train.jsonl").write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")

    report = clean(source, target)

    assert report["beforeCount"] == 2
    assert report["afterCount"] == 1
    assert report["excludedTopics"] == {"验收A-支付接口越权": 1}
    output = (target / "attacker_train.jsonl").read_text(encoding="utf-8")
    assert "通用安全测试" in output
    assert "验收A-支付接口越权" not in output


def test_clean_rejects_invalid_examples(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "clean"
    source.mkdir()
    (source / "attacker_train.jsonl").write_text("{}\n", encoding="utf-8")

    try:
        clean(source, target)
    except ValueError as exc:
        assert "invalid attacker example" in str(exc)
    else:
        raise AssertionError("invalid example should fail closed")
