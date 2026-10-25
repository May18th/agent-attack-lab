"""审核通过后，把 v2 Partner 的新 AIC / registrationId 回填到本仓库。

用法：

    # 只打印（默认，不改文件）
    .venv/Scripts/python.exe scripts/adopt_partner_aics.py

    # 确认新 AIC 无误后写入 backend/agent-identities.json
    .venv/Scripts/python.exe scripts/adopt_partner_aics.py --write

脚本只读 ``.data/acps-registration-v3/<role>/acps/enrollment.json``（由
``register_partner_agents.py`` 注册时生成），不接触任何私钥或凭据。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = ROOT / ".data" / "acps-registration-v3"
IDENTITIES = ROOT / "agent-identities.json"
ROLES = {"attack": "attacker", "defender": "defender", "leader": "leader"}

# 换 AIC 后需要同步修改的运行时变量（打印清单用）
ENV_KEYS = {
    "attacker": ("AGENT_LOCAL_AIC", "AGENT_AIP_EXPECTED_PARTNER_AIC"),
    "defender": ("AGENT_LOCAL_AIC", "AGENT_AIP_EXPECTED_PARTNER_AIC"),
    "leader": ("AGENT_LOCAL_AIC", "AGENT_AIP_LEADER_ID"),
}


def read_enrollment(role: str) -> dict:
    path = WORKSPACE_ROOT / role / "acps" / "enrollment.json"
    if not path.exists():
        raise SystemExit(f"找不到 {path}；先跑 register_partner_agents.py 完成注册")
    return json.loads(path.read_text(encoding="utf-8"))


def extract(enrollment: dict) -> tuple[str, str, str]:
    aic = ((enrollment.get("identity") or {}).get("ref") or {}).get("aic") or ""
    registration_id = enrollment.get("registrationId") or ""
    status = (enrollment.get("identity") or {}).get("status") or ""
    if not aic:
        raise SystemExit("enrollment.json 里没有 AIC：说明还没审核通过")
    return aic, registration_id, status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write", action="store_true", help="写入 agent-identities.json"
    )
    args = parser.parse_args()

    identities = json.loads(IDENTITIES.read_text(encoding="utf-8"))
    report: list[str] = []

    for role, identity_key in ROLES.items():
        aic, registration_id, status = extract(read_enrollment(role))
        entry = identities.get(identity_key) or {}
        old_aic = entry.get("aic") or "(空)"
        report.append(
            f"{identity_key}: {old_aic} -> {aic} (status={status}, registrationId={registration_id})"
        )
        if args.write:
            entry["aic"] = aic
            entry["registrationId"] = registration_id
            identities[identity_key] = entry

    print("\n".join(report))

    if args.write:
        IDENTITIES.write_text(
            json.dumps(identities, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"\n已写入 {IDENTITIES}")
    else:
        print("\n未写入（加 --write 生效）")

    print("\n还需手工同步的运行时变量（本机 .env 与 VPS .env 各设一份）：")
    for identity_key in ROLES.values():
        keys = ", ".join(ENV_KEYS[identity_key])
        print(f"  {identity_key} 进程: {keys}")
    print("  证书文件需按新 AIC 重新签发后替换 AGENT_AIP_MTLS_CERT_FILE / _KEY_FILE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
