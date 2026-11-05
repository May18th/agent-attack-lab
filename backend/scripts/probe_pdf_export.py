"""在生产环境里生成一份样例 PDF，用于验证依赖与中文字体是否真的可用。

刻意只用标准库 + 项目自身代码，避免额外依赖：
    python scripts/probe_pdf_export.py --base64

- 不给参数时打印字节数与 PDF 头；
- 给 ``--base64`` 时把整份 PDF 打成 base64，方便在 CI 日志里取回本地渲染检查；
- 给 ``--out PATH`` 时另存文件。
"""

from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

_SAMPLE_ROWS = [
    {
        "id": "probe-1",
        "received_at": "2026-10-30T15:00:00",
        "q1_role": "后端开发工程师",
        "q2_method": "自建提示词回归集，每次版本发布前跑一遍",
        "q2_pain_point": "跑完看不到明确证据",
        "q3_ranking": ["证据可追溯", "分类标准", "出报告", "可视化"],
        "q4_can_judge": "能，证据链清晰",
        "q4_distrust_areas": ["裁决结果"],
        "q5_willingness": "敢，有授权就敢用",
        "q5_concern": "担心误报率高，团队会不信任这套流程",
        "q6_reuse_score": 5,
        "q6_must_fix": "希望能接进 CI，每次发版自动跑",
    },
    {
        "id": "probe-2",
        "received_at": "2026-10-30T15:05:00",
        "q1_role": "安全研究员 / 红队人员",
        "q2_method": "用开源数据集跑一轮，人工挑几条明显的",
        "q2_pain_point": "结果难以复现 / 对账",
        "q3_ranking": ["证据可追溯", "出报告", "分类标准", "可视化"],
        "q4_can_judge": "部分能，有些地方看不懂",
        "q4_distrust_areas": ["分类依据", "评分"],
        "q5_willingness": "有条件敢用（需补充验证）",
        "q5_concern": "模型判定和规则判定混在一起时，说不清是哪条生效",
        "q6_reuse_score": 4,
        "q6_must_fix": "裁决过程要能看到原始证据，不要只给结论",
    },
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--part", default="summary", choices=("all", "summary", "detail"))
    parser.add_argument("--out", default="")
    parser.add_argument("--base64", action="store_true", dest="as_base64")
    args = parser.parse_args()

    try:
        from agent_attack_lab import survey_pdf
    except ImportError as exc:  # 依赖没装齐时给出一句能直接照做的提示
        print(f"import failed: {exc}", file=sys.stderr)
        return 2

    try:
        payload = survey_pdf.build_survey_pdf(_SAMPLE_ROWS, part=args.part)
    except Exception as exc:  # noqa: BLE001 - 自检脚本要把真实异常原样打印出来
        print(f"build failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 3

    print(f"part={args.part} bytes={len(payload)} head={payload[:5]!r}")
    if args.out:
        Path(args.out).write_bytes(payload)
        print(f"written {args.out}")
    if args.as_base64:
        print("---BASE64---")
        print(base64.b64encode(payload).decode("ascii"))
        print("---END---")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
