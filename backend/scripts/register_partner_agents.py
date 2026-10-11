"""Prepare or submit the two Partner agents for a fresh integrated registration.

The command is deliberately dry-run by default. Registry credentials are read
only from ACPS_USERNAME and ACPS_PASSWORD in the current process and are never
written to a workspace, command line, or Git.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from wit import (
    AcpsConfig,
    AcpsDirect,
    AcpsRegistration,
    AgentCertificateRequest,
    AgentProviderProfile,
    RegistryPasswordCredentials,
    WitAgent,
    WitRuntime,
    capability,
)


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = ROOT / ".data" / "acps-registration-renewal"
INFRA = {
    "registry_url": "https://wt.ioa.pub/registry-server",
    "ca_url": "https://wt.ioa.pub/ca-server",
    "discovery_url": "https://wt.ioa.pub/discovery/acps-adp-v2/discover",
}


@capability(
    id="attack-sample-generation",
    description="按难度生成隔离环境中的攻防测试样本。",
    acps_skill=True,
    public=True,
    tags=["攻防", "安全测试"],
)
def attack_capability(difficulty: str, topic: str) -> dict[str, str]:
    return {"difficulty": difficulty, "topic": topic}


@capability(
    id="attack-sample-detection",
    description="识别隔离环境中的攻防测试样本并返回风险判断。",
    acps_skill=True,
    public=True,
    tags=["攻防", "风险检测"],
)
def defender_capability(sample: dict[str, object]) -> dict[str, object]:
    return {"sample": sample}


AGENTS = {
    "attack": {
        "agent_id": "attack-sample-generation-renewal",
        "display_name": "智能体攻防实验室-攻击智能体",
        "description": "生成隔离环境中的攻防安全测试样本。",
        "instructions": "仅生成隔离环境中的安全测试样本，不访问真实目标。",
        "endpoint": "https://attack.yuanyiagentzhandui.cn/rpc",
        "capability": attack_capability,
    },
    "defender": {
        "agent_id": "attack-sample-detection-renewal",
        "display_name": "智能体攻防实验室-防守智能体",
        "description": "识别隔离环境中的攻防测试样本并输出风险判断。",
        "instructions": "仅分析提交的隔离测试样本，不访问真实目标。",
        "endpoint": "https://defense.yuanyiagentzhandui.cn/rpc",
        "capability": defender_capability,
    },
}


def runtime_for(kind: str) -> WitRuntime:
    spec = AGENTS[kind]
    agent = WitAgent(
        id=spec["agent_id"],
        display_name=spec["display_name"],
        description=spec["description"],
        version="1.0.0",
        instructions=spec["instructions"],
        capabilities=[spec["capability"]],
        protocols=[AcpsDirect()],
    )
    acps = AcpsConfig.custom(
        **INFRA,
        public_endpoint=spec["endpoint"],
        provider=AgentProviderProfile(
            organization="智能体攻防实验室项目组",
            country_code="CN",
        ),
        certificate=AgentCertificateRequest(requested_validity=365),
        registration=AcpsRegistration.integrated(),
        strict_interop=True,
        request_timeout_seconds=90,
    )
    return WitRuntime(agent, workspace=WORKSPACE_ROOT / kind, acps=acps)


async def run(kinds: list[str], submit: bool) -> int:
    credentials = None
    if submit:
        credentials = RegistryPasswordCredentials.from_env()
    results = []
    for kind in kinds:
        runtime = runtime_for(kind)
        draft_path = runtime.save_acs()
        validation = await runtime.validate()
        result = {
            "agent": kind,
            "workspace": str(runtime.workspace),
            "draft": str(draft_path),
            "aic": runtime.acs_draft().get("aic", ""),
            "valid": validation.get("valid", False),
        }
        if submit:
            enrollment = await runtime.up_until_ready(credentials=credentials, max_steps=8)
            result.update(
                {
                    "status": enrollment.status,
                    "nextAction": enrollment.next_action,
                    "summary": enrollment.summary(),
                }
            )
        results.append(result)
    print(json.dumps({"submitted": submit, "agents": results}, ensure_ascii=False, indent=2))
    return 0 if all(item["valid"] for item in results) else 2


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", choices=("attack", "defender", "both"), default="both")
    parser.add_argument(
        "--submit",
        action="store_true",
        help="submit to Registry; without this flag only save and validate drafts",
    )
    args = parser.parse_args()
    kinds = ["attack", "defender"] if args.agent == "both" else [args.agent]
    raise SystemExit(asyncio.run(run(kinds, submit=args.submit)))


if __name__ == "__main__":
    main()
