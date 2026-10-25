"""校验 AMP 心跳是否让智能体在梧桐 Discovery 中变为"在线"。

用法（在 backend 目录，默认检查 agent-identities.json 里的三只智能体）：

    .venv\\Scripts\\python.exe scripts\\verify_amp_alive.py
    .venv\\Scripts\\python.exe scripts\\verify_amp_alive.py --aic <AIC> --wait 120

判定口径与平台一致：请求**不带** ``extFilter``（即使用平台缺省的
``alive=online``），能命中并且 ``aliveMap[aic].alive == true`` 才算通过。
这也是首页「输入 AIC 查询在线状态」实际走的请求。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

DISCOVERY_URL = "https://wt.ioa.pub/discovery/acps-adp-v2/discover"
DEFAULT_IDENTITIES = Path(__file__).resolve().parents[1] / "agent-identities.json"


def load_identities(path: Path) -> list[tuple[str, str]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    items: list[tuple[str, str]] = []
    for role, entry in raw.items():
        if role.startswith("_"):
            continue
        aic = entry if isinstance(entry, str) else str(entry.get("aic", ""))
        if aic.strip():
            name = role if isinstance(entry, str) else str(entry.get("name", role))
            items.append((f"{role} / {name}", aic.strip()))
    return items


def probe(client: httpx.Client, aic: str) -> tuple[bool, str]:
    """按平台首页同款请求查询；返回 (是否在线, 说明)。"""
    payload = {
        "type": "filtered",
        "limit": 5,
        "filter": {"conditions": [{"field": "aic", "op": "eq", "value": aic}]},
    }
    response = client.post(DISCOVERY_URL, json=payload)
    response.raise_for_status()
    body = response.json()
    if body.get("error"):
        return False, f"discovery error: {body['error']}"
    result = body.get("result") or {}
    acs_map = result.get("acsMap") or {}
    if aic not in acs_map:
        return False, "未被平台收录为在线（缺省 alive=online 查询为空）"
    alive_info = (result.get("aliveMap") or {}).get(aic) or {}
    if alive_info.get("alive") is True:
        return True, f"在线 · lastSeen={alive_info.get('aliveLastSeenAt')}"
    return False, f"命中但不在线 · aliveMap={alive_info or '无记录'}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--aic", action="append", default=[], help="可重复；默认读身份文件"
    )
    parser.add_argument("--identities", default=str(DEFAULT_IDENTITIES))
    parser.add_argument("--wait", type=float, default=60.0, help="最长等待秒数")
    parser.add_argument("--interval", type=float, default=8.0, help="轮询间隔秒数")
    parser.add_argument("--json", action="store_true", help="输出机器可读结果")
    args = parser.parse_args()

    if args.aic:
        targets = [(f"aic:{item}", item) for item in args.aic]
    else:
        identity_path = Path(args.identities)
        if not identity_path.is_file():
            print(f"身份文件不存在：{identity_path}", file=sys.stderr)
            return 2
        targets = load_identities(identity_path)

    deadline = time.monotonic() + max(0.0, args.wait)
    pending = dict(targets)
    results: dict[str, dict[str, object]] = {}
    with httpx.Client(timeout=20.0, trust_env=False) as client:
        while True:
            for label, aic in list(pending.items()):
                try:
                    alive, detail = probe(client, aic)
                except Exception as exc:  # noqa: BLE001 - 网络抖动不立即判失败
                    alive, detail = False, f"查询异常：{exc}"
                results[label] = {"aic": aic, "alive": alive, "detail": detail}
                if alive:
                    pending.pop(label, None)
            if not pending or time.monotonic() >= deadline:
                break
            if not args.json:
                print(f"… 仍有 {len(pending)} 只未在线，{args.interval:.0f}s 后重试")
            time.sleep(args.interval)

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        for label, item in results.items():
            mark = "OK  " if item["alive"] else "FAIL"
            print(
                f"[{mark}] {label}\n       aic={item['aic']}\n       {item['detail']}"
            )
    failed = [label for label, item in results.items() if not item["alive"]]
    if failed:
        print(
            f"\n{len(failed)} 只仍未在线。先确认心跳进程在跑："
            "AGENT_AMP_ENABLED=1 + AGENT_AMP_ROLE/AIC，且 .data/amp/*.jsonl 在增长。",
            file=sys.stderr,
        )
        return 2
    print("\n全部在线：平台缺省查询（含首页 AIC 在线状态查询）可命中。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
