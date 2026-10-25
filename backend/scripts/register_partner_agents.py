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
# v2：旧 1.0.0 已审核通过且 ACS 冻结（PUT 被平台禁止），只能用新版本号 + 新 workspace
# 重新注册，由 Registry 分配新 AIC。历史 workspace 为 .data/acps-registration-renewal。
WORKSPACE_ROOT = ROOT / ".data" / "acps-registration-v3"
AGENT_VERSION = "1.2.0"
INFRA = {
    "registry_url": "https://wt.ioa.pub/registry-server",
    "ca_url": "https://wt.ioa.pub/ca-server",
    "discovery_url": "https://wt.ioa.pub/discovery/acps-adp-v2/discover",
}


@capability(
    id="attack-sample-generation",
    description=(
        "攻击智能体核心能力：作为攻击智能体（红队攻击智能体）按 low/mid/high 难度生成隔离环境中的"
        "攻防安全测试样本，覆盖提示词注入、越狱、指令劫持、数据泄露、工具滥用等攻击手法。"
        "用户说“找攻击智能体”“要一个攻击智能体”“用攻击智能体生成样本”时使用本技能。"
    ),
    acps_skill={"name": "攻击智能体·攻防安全测试样本生成"},
    examples=[
        "让攻击智能体生成 high 难度的提示词注入攻击样本",
        "用攻击智能体为 SQL 注入主题生成 5 条安全测试样本",
        "找攻击智能体构造一批红队测试用的越狱样本",
    ],
    public=True,
    tags=[
        "攻击智能体",
        "红队攻击智能体",
        "红队",
        "攻防",
        "安全测试",
        "攻击样本生成",
        "提示词注入",
        "越狱",
    ],
)
def attack_capability(difficulty: str, topic: str) -> dict[str, str]:
    return {"difficulty": difficulty, "topic": topic}


@capability(
    id="attack-sample-detection",
    description=(
        "防守智能体核心能力：作为防守智能体（蓝队防守智能体）识别并分析攻击测试样本，"
        "输出风险等级、命中判定、拦截结果与修复建议。用户说“找防守智能体”“要一个防守智能体”"
        "“让防守智能体检测风险”时使用本技能。"
    ),
    acps_skill={"name": "防守智能体·攻击样本风险检测"},
    examples=[
        "让防守智能体检测这批样本是否存在风险并给出风险等级",
        "用防守智能体分析提示词注入样本并输出拦截结果和修复建议",
        "找防守智能体判断这些内容是不是攻击样本",
    ],
    public=True,
    tags=[
        "防守智能体",
        "蓝队防守智能体",
        "蓝队",
        "风险检测",
        "攻击样本检测",
        "拦截",
        "安全审计",
        "攻防",
    ],
)
def defender_capability(sample: dict[str, object]) -> dict[str, object]:
    return {"sample": sample}


@capability(
    id="battle-orchestration",
    description=(
        "主调度智能体核心能力：作为主调度智能体（编排智能体／仲裁智能体）按难度与主题创建攻防战局，"
        "依次调用攻击智能体生成测试样本、防守智能体检测风险，聚合双方结果做独立裁决并生成完整战报。"
        "用户说“找主调度智能体”“要一个主调度智能体”“用主调度智能体编排战局”时使用本技能。"
    ),
    acps_skill={"name": "主调度智能体·攻防战局编排"},
    examples=[
        "让主调度智能体创建 high 难度的 SQL 注入战局并返回完整攻防结果",
        "用主调度智能体编排一次攻击与防守的完整对抗",
        "找主调度智能体查询历史战局并按关键词筛选",
    ],
    public=True,
    tags=[
        "主调度智能体",
        "调度智能体",
        "编排智能体",
        "仲裁智能体",
        "Leader",
        "攻防战局",
        "任务编排",
        "智能体攻防",
    ],
)
def leader_capability(difficulty: str, topic: str) -> dict[str, str]:
    return {"difficulty": difficulty, "topic": topic}


AGENTS = {
    "attack": {
        "agent_id": "attack-sample-generation-v3",
        "display_name": "智能体攻防实验室-攻击智能体",
        "description": (
            "智能体攻防实验室的攻击方智能体（红队）。按难度生成提示词注入、越狱、指令劫持、"
            "数据泄露、工具滥用等 AI 安全测试样本，用于隔离环境中的漏洞验证与安全评估。"
            "适用于攻击样本生成、红队测试、AI 渗透测试、对抗样本构造与智能体安全评估等请求。"
        ),
        "instructions": "仅生成隔离环境中的安全测试样本，不访问真实目标。",
        "endpoint": "https://attack.yuanyiagentzhandui.cn/rpc",
        "capability": attack_capability,
    },
    "defender": {
        "agent_id": "attack-sample-detection-v3",
        "display_name": "智能体攻防实验室-防守智能体",
        "description": (
            "智能体攻防实验室的防守方智能体（蓝队）。识别并分析攻击测试样本，输出风险等级、"
            "命中判定、拦截结果与修复建议，用于提示词注入检测、越狱识别、敏感数据泄露检测、"
            "AI 安全防护与合规审计等请求。"
        ),
        "instructions": "仅分析提交的隔离测试样本，不访问真实目标。",
        "endpoint": "https://defense.yuanyiagentzhandui.cn/rpc",
        "capability": defender_capability,
    },
    "leader": {
        "agent_id": "battle-orchestration-v2",
        "display_name": "智能体攻防实验室-主调度智能体",
        "description": (
            "智能体攻防实验室的主调度智能体（调度智能体／编排智能体／仲裁智能体）。接收战局请求（难度、主题），"
            "编排攻击智能体生成测试样本、防守智能体检测风险，聚合样本、命中、风险与修复建议，"
            "做独立裁决并生成完整战报；提供战局历史、回放与统计。"
        ),
        "instructions": "负责任务分解、Partner 调用、结果整合与仲裁裁决。",
        "endpoint": "https://api.yuanyiagentzhandui.cn/rpc",
        "web_app_url": "https://www.yuanyiagentzhandui.cn/",
        "capability": leader_capability,
    },
}


def configure(
    *,
    version: str | None = None,
    endpoint: str | None = None,
    workspace: str | None = None,
) -> None:
    """覆盖版本号 / endpoint / workspace，便于为同一角色注册不同 endpoint 的版本。"""
    global AGENT_VERSION, WORKSPACE_ROOT
    if version:
        AGENT_VERSION = version
    if workspace:
        WORKSPACE_ROOT = ROOT / workspace
    if endpoint:
        for spec in AGENTS.values():
            if spec.get("capability") is leader_capability:
                spec["endpoint"] = endpoint


def runtime_for(kind: str) -> WitRuntime:
    spec = AGENTS[kind]
    agent = WitAgent(
        id=spec["agent_id"],
        display_name=spec["display_name"],
        description=spec["description"],
        version=AGENT_VERSION,
        instructions=spec["instructions"],
        capabilities=[spec["capability"]],
        protocols=[AcpsDirect()],
    )
    acps = AcpsConfig.custom(
        **INFRA,
        public_endpoint=spec["endpoint"],
        web_app_url=spec.get("web_app_url"),
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
        acs = runtime.acs_draft()
        result = {
            "agent": kind,
            "workspace": str(runtime.workspace),
            "draft": str(draft_path),
            "aic": acs.get("aic", ""),
            "version": acs.get("version", ""),
            "descriptionLength": len(acs.get("description") or ""),
            "skills": [
                {
                    "name": (skill or {}).get("name"),
                    "examples": len((skill or {}).get("examples") or []),
                }
                for skill in (acs.get("skills") or [])
            ],
            "valid": validation.get("valid", False),
        }
        if submit:
            enrollment = await runtime.up_until_ready(
                credentials=credentials, max_steps=8
            )
            result.update(
                {
                    "status": enrollment.status,
                    "nextAction": enrollment.next_action,
                    "summary": enrollment.summary(),
                }
            )
        results.append(result)
    print(
        json.dumps(
            {"submitted": submit, "agents": results}, ensure_ascii=False, indent=2
        )
    )
    return 0 if all(item["valid"] for item in results) else 2


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--agent",
        choices=("attack", "defender", "leader", "both"),
        default="both",
    )
    parser.add_argument(
        "--submit",
        action="store_true",
        help="submit to Registry; without this flag only save and validate drafts",
    )
    parser.add_argument("--version", help="覆盖注册版本号，例如 1.2.1")
    parser.add_argument(
        "--endpoint", help="覆盖 endpoint，例如 https://leader-mtls.example.cn/rpc"
    )
    parser.add_argument(
        "--workspace",
        help="覆盖 workspace 目录（相对 backend/），例如 .data/acps-registration-v4-leader-mtls",
    )
    args = parser.parse_args()
    configure(version=args.version, endpoint=args.endpoint, workspace=args.workspace)
    kinds = ["attack", "defender"] if args.agent == "both" else [args.agent]
    raise SystemExit(asyncio.run(run(kinds, submit=args.submit)))


if __name__ == "__main__":
    main()
