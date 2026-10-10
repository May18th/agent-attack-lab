from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess

import pytest


POWERSHELL = shutil.which("pwsh") or shutil.which("powershell")
SCRIPT = Path(__file__).parents[1] / "scripts" / "verify_acp_mtls_config.ps1"


def _base_env(tmp_path: Path) -> dict[str, str]:
    files = {}
    for name in ("cert.pem", "key.pem", "ca.pem"):
        path = tmp_path / name
        path.write_text("test-only", encoding="utf-8")
        files[name] = str(path)
    env = os.environ.copy()
    env.update(
        {
            "AGENT_AIP_LEADER_ID": "1.2.156.3088.1.test.leader",
            "AGENT_ATTACKER_RPC_URL": "https://attacker.example/rpc",
            "AGENT_DEFENDER_RPC_URL": "https://defender.example/rpc",
            "AGENT_AIP_MTLS_CERT_FILE": files["cert.pem"],
            "AGENT_AIP_MTLS_KEY_FILE": files["key.pem"],
            "AGENT_AIP_CA_FILE": files["ca.pem"],
            "AGENT_IDENTITY_BINDING_ENABLED": "0",
            "AGENT_PARTNER_IDENTITY_BINDING_ENABLED": "0",
        }
    )
    return env


def _run_script(tmp_path: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    if POWERSHELL is None:
        pytest.skip("PowerShell is not available")
    return subprocess.run(
        [POWERSHELL, "-NoProfile", "-File", str(SCRIPT), *arguments],
        cwd=SCRIPT.parents[1],
        env=_base_env(tmp_path),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def test_preflight_reports_both_identity_binding_switches(tmp_path: Path) -> None:
    result = _run_script(tmp_path)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Leader 服务端身份绑定配置：未开启" in result.stdout
    assert "Partner 服务端身份绑定配置：未开启" in result.stdout
    assert "不代表真实 mTLS 通道已经验收" in result.stdout


@pytest.mark.parametrize(
    ("argument", "message"),
    [
        ("-RequireLeaderIdentityBinding", "AGENT_IDENTITY_BINDING_ENABLED 未开启"),
        (
            "-RequirePartnerIdentityBinding",
            "AGENT_PARTNER_IDENTITY_BINDING_ENABLED 未开启",
        ),
    ],
)
def test_required_identity_binding_switch_must_actually_be_enabled(
    tmp_path: Path,
    argument: str,
    message: str,
) -> None:
    result = _run_script(tmp_path, argument)

    assert result.returncode != 0
    assert message in result.stdout + result.stderr
