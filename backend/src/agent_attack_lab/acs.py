"""Build a valid ACS document for 智能体攻防实验室.

The registry assigns the AIC. This module intentionally refuses to invent one;
set ``AGENT_AIC`` after approval or when the registry gives you a real value.
"""

from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

from acps_sdk.acs import (
    AgentCapabilitySpec,
    AgentCapabilities,
    AgentProvider,
    AgentSkill,
)
from acps_sdk.aic import validate_aic_format


def build_acs(*, name: str, description: str, skill_id: str) -> AgentCapabilitySpec:
    aic = os.getenv("AGENT_AIC", "").strip()
    if not aic:
        raise RuntimeError("AGENT_AIC 未设置：必须使用平台分配的真实 AIC，不能自行编造")
    valid, error = validate_aic_format(aic)
    if not valid:
        raise RuntimeError(f"AGENT_AIC 格式无效：{error}")

    organization = os.getenv("AGENT_ORGANIZATION", "智能体攻防实验室项目组")
    contact_name = os.getenv("AGENT_CONTACT_NAME", "")
    contact_email = os.getenv("AGENT_CONTACT_EMAIL", "")
    if not contact_name or not contact_email:
        raise RuntimeError("请设置 AGENT_CONTACT_NAME 和 AGENT_CONTACT_EMAIL")
    placeholders = ("平台分配", "真实AIC", "你的真实", "填写真实", "example.com")
    if any(value in " ".join((organization, contact_name, contact_email)) for value in placeholders):
        raise RuntimeError("组织、联系人和邮箱仍包含占位文本，请替换为真实信息")

    return AgentCapabilitySpec(
        aic=aic,
        active=True,
        lastModifiedTime=datetime.now(timezone.utc).isoformat(),
        protocolVersion="02.02",
        name=name,
        description=description,
        version="1.0.0",
        provider=AgentProvider(
            countryCode="CN",
            organization=organization,
            name=contact_name,
            email=contact_email,
        ),
        securitySchemes={},
        capabilities=AgentCapabilities(streaming=False, notification=False),
        defaultInputModes=["application/json"],
        defaultOutputModes=["application/json"],
        skills=[
            AgentSkill(
                id=skill_id,
                name=name,
                description=description,
                version="1.0.0",
                tags=["攻防", "安全测试", "智能体协作"],
                inputModes=["application/json"],
                outputModes=["application/json"],
            )
        ],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="生成智能体攻防实验室 ACS JSON")
    parser.add_argument("--name", required=True)
    parser.add_argument("--description", required=True)
    parser.add_argument("--skill-id", required=True)
    parser.add_argument("--output", type=Path, default=Path("acs.json"))
    args = parser.parse_args()
    acs = build_acs(name=args.name, description=args.description, skill_id=args.skill_id)
    args.output.write_text(acs.to_json(indent=2), encoding="utf-8")
    print(f"已生成 {args.output}")


if __name__ == "__main__":
    main()
