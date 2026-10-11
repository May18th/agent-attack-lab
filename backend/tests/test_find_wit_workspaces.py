from __future__ import annotations

from pathlib import Path
import shutil
import subprocess

import pytest


BASH = shutil.which("bash")
SCRIPT = Path(__file__).parents[1] / "scripts" / "find-wit-workspaces.sh"


def _run(search_root: Path) -> subprocess.CompletedProcess[str]:
    if BASH is None:
        pytest.skip("bash is not available")
    return subprocess.run(
        [BASH, str(SCRIPT), str(search_root)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def test_reports_when_no_enrollment_state_exists(tmp_path: Path) -> None:
    result = _run(tmp_path)

    assert result.returncode == 1
    assert "NOT_FOUND  no WIT enrollment.json" in result.stdout


def test_reports_incomplete_workspace_without_reading_credentials(
    tmp_path: Path,
) -> None:
    acps = tmp_path / "agent" / "acps"
    acps.mkdir(parents=True)
    (acps / "enrollment.json").write_text(
        "SECRET-MARKER-DO-NOT-PRINT", encoding="utf-8"
    )

    result = _run(tmp_path)

    assert result.returncode == 1
    assert f"CANDIDATE  {acps}" in result.stdout
    assert "RESULT   incomplete workspace" in result.stdout
    assert "SECRET-MARKER-DO-NOT-PRINT" not in result.stdout


def test_accepts_complete_looking_workspace(tmp_path: Path) -> None:
    acps = tmp_path / "agent" / "acps"
    for directory in (acps / "secrets", acps / "client", acps / "server"):
        directory.mkdir(parents=True, exist_ok=True)
    for relative_path in (
        "enrollment.json",
        "acs.final.json",
        "secrets/eab.json",
        "secrets/registry-token.json",
        "client/agent-cert.pem",
        "client/agent-key.pem",
        "server/agent-cert.pem",
        "server/agent-key.pem",
        "trust-bundle.pem",
    ):
        (acps / relative_path).write_text("placeholder", encoding="utf-8")

    result = _run(tmp_path)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "RESULT   complete-looking workspace" in result.stdout
    assert "SUMMARY  candidates=1 complete-looking=1" in result.stdout
