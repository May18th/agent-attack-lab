"""审批通过后一键收尾 v2 Partner 注册：签发证书、取回新 AIC、回填身份文件。

必须用隔离环境跑（需要 wit）：

    .venv-register\\Scripts\\python.exe scripts\\finalize_partner_v2.py

常用用法：

    # 只看审批状态（不发注册请求）
    .venv-register\\Scripts\\python.exe scripts\\finalize_partner_v2.py

    # 每 60 秒轮询，全部通过后自动签发证书并打印新 AIC
    .venv-register\\Scripts\\python.exe scripts\\finalize_partner_v2.py --poll 60

    # 同上，并把新 AIC 写回 agent-identities.json
    .venv-register\\Scripts\\python.exe scripts\\finalize_partner_v2.py --poll 60 --write

凭据只从当前进程的 ACPS_USERNAME / ACPS_PASSWORD 读取，不落盘。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

REGISTRY = "https://wt.ioa.pub/registry-server"
# v3（1.2.0）记录 id 与 enrollment workspace 的对应关系
TARGETS = {
    "attacker": {
        "agent_id": "01a17338-2f73-7206-b3de-7c9f56169857",
        "kind": "attack",
    },
    "defender": {
        "agent_id": "01a17338-37f3-71b5-9c08-bb59e9e5b5d9",
        "kind": "defender",
    },
}
IDENTITIES = ROOT / "agent-identities.json"


def _request(path: str, *, token: str | None = None, form: dict | None = None) -> dict:
    url = f"{REGISTRY}{path}"
    data = None
    headers = {"Accept": "application/json"}
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        url, data=data, headers=headers, method="POST" if data else "GET"
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def login() -> str:
    username = os.getenv("ACPS_USERNAME", "").strip()
    password = os.getenv("ACPS_PASSWORD", "").strip()
    if not username or not password:
        raise SystemExit("缺少 ACPS_USERNAME / ACPS_PASSWORD 环境变量")
    payload = _request(
        "/api/v1/auth/login",
        form={"grant_type": "password", "username": username, "password": password},
    )
    token = payload.get("access_token")
    if not token:
        raise SystemExit("登录失败：未返回 access_token")
    return token


def approval_of(token: str, agent_id: str) -> tuple[str, str]:
    detail = _request(f"/api/v1/agent/client/{agent_id}", token=token)
    return str(detail.get("approval_status") or "?"), str(detail.get("aic") or "")


def report(token: str) -> dict[str, str]:
    states: dict[str, str] = {}
    for role, target in TARGETS.items():
        status, _ = approval_of(token, target["agent_id"])
        states[role] = status
        print(f"  {role:<9} approval={status}")
    return states


async def enroll(role: str) -> str:
    from register_partner_agents import runtime_for  # 复用 v2 的 agent 定义

    runtime = runtime_for(TARGETS[role]["kind"])
    result = await runtime.up_until_ready(max_steps=8)
    enrollment_path = Path(runtime.workspace) / "acps" / "enrollment.json"
    aic = ""
    if enrollment_path.exists():
        data = json.loads(enrollment_path.read_text(encoding="utf-8"))
        aic = ((data.get("identity") or {}).get("ref") or {}).get("aic") or ""
    print(f"  {role:<9} status={result.status} aic={aic or '(未签发)'}")
    return aic


def write_identities(aics: dict[str, str]) -> None:
    identities = json.loads(IDENTITIES.read_text(encoding="utf-8"))
    for role, aic in aics.items():
        if aic:
            identities.setdefault(role, {})["aic"] = aic
    IDENTITIES.write_text(
        json.dumps(identities, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\n已写回 {IDENTITIES}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--poll", type=int, default=0, help="轮询间隔秒数，0 表示只查一次"
    )
    parser.add_argument("--timeout", type=int, default=3600, help="轮询总超时秒数")
    parser.add_argument(
        "--write", action="store_true", help="通过后写回 agent-identities.json"
    )
    args = parser.parse_args()

    token = login()
    deadline = time.monotonic() + args.timeout

    while True:
        print("审批状态：")
        states = report(token)
        if all(state == "APPROVED" for state in states.values()):
            break
        if args.poll <= 0:
            print("\n还有未通过的记录，加 --poll 60 可自动轮询。")
            return 1
        if time.monotonic() >= deadline:
            print("\n轮询超时，仍未全部通过。")
            return 1
        time.sleep(args.poll)
        token = login()  # 令牌可能过期，每轮重新登录
        print()

    print("\n全部通过，开始签发证书并取回 AIC：")
    aics: dict[str, str] = {}
    for role in TARGETS:
        aics[role] = asyncio.run(enroll(role))

    missing = [role for role, aic in aics.items() if not aic]
    if missing:
        print(f"\n以下角色未取到 AIC，需检查：{', '.join(missing)}")
        return 2

    if args.write:
        write_identities(aics)
    else:
        print("\n未写回身份文件（加 --write 生效）")

    print("\n下一步：")
    print(
        "  1) 把新证书/私钥同步到 VPS partners 目录，更新 AGENT_AIP_MTLS_* 与 AGENT_LOCAL_AIC"
    )
    print("  2) .\\restart.ps1 后跑 scripts\\verify_amp_alive.py 验收")
    print(
        "  3) 验收通过再删除旧 1.0.0（平台控制台或 DELETE /api/v1/agent/client/{id}）"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
