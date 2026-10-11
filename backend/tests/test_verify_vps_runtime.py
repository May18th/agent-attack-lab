from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess

import pytest


BASH = shutil.which("bash")
SCRIPT = Path(__file__).parents[1] / "scripts" / "verify-vps-runtime.sh"


def _write_command(directory: Path, name: str, body: str) -> None:
    path = directory / name
    path.write_text(f"#!/usr/bin/env bash\n{body}\n", encoding="utf-8")
    path.chmod(0o755)


def test_vps_verifier_accepts_enabled_active_healthy_runtime(tmp_path: Path) -> None:
    if BASH is None:
        pytest.skip("bash is not available")

    _write_command(tmp_path, "loginctl", "printf yes")
    _write_command(tmp_path, "curl", "exit 0")
    _write_command(
        tmp_path,
        "systemctl",
        """
if [[ "$1" == "--user" && "$2" == "is-enabled" ]]; then
  printf enabled
elif [[ "$1" == "--user" && "$2" == "is-active" ]]; then
  printf active
elif [[ "$1" == "--user" && "$2" == "cat" ]]; then
  exit 0
elif [[ "$1" == "--user" && "$2" == "show" ]]; then
  printf 'MainPID=123\\nActiveEnterTimestamp=mock\\n'
else
  exit 1
fi
""".strip(),
    )
    env = os.environ.copy()
    env["PATH"] = f"{tmp_path}{os.pathsep}{env['PATH']}"
    env["DEPLOY_USER"] = "deployer"

    result = subprocess.run(
        [BASH, str(SCRIPT)],
        cwd=SCRIPT.parents[2],
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "PASS  login linger enabled" in result.stdout
    assert "PASS  cloudflared.service active" in result.stdout
    assert "PASS  Public API health" in result.stdout
    assert "Verification passed" in result.stdout
