from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from shell_guard import posix_shell


SCRIPT = Path(__file__).parents[1] / "scripts" / "start-service.sh"
DEPLOY_SCRIPT = Path(__file__).parents[1] / "scripts" / "deploy-production.sh"
REPO_ROOT = SCRIPT.parents[2]


def test_start_service_adds_release_src_to_pythonpath() -> None:
    source = SCRIPT.read_text(encoding="utf-8")

    assert 'export PYTHONPATH="$PWD/src${PYTHONPATH:+:$PYTHONPATH}"' in source


def test_start_service_is_executable_in_git() -> None:
    result = subprocess.run(
        ["git", "ls-files", "-s", "--", "backend/scripts/start-service.sh"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    assert result.stdout.startswith("100755 ")


def test_deploy_script_verifies_running_release_context() -> None:
    source = DEPLOY_SCRIPT.read_text(encoding="utf-8")

    assert 'unit_fragment_path=$(systemctl --user show "${services[0]}" -p FragmentPath --value)' in source
    assert 'user_unit_dir=$(dirname "$unit_fragment_path")' in source
    assert 'path="$user_unit_dir/$service.d/production-release.conf"' in source
    assert 'path="$user_unit_dir/$service.service.d/production-release.conf"' not in source
    assert 'systemctl --user show "$service" -p MainPID --value' in source
    assert 'systemctl --user show "$service" -p FragmentPath -p DropInPaths' in source
    assert 'systemctl --user cat "$service"' in source
    assert 'wait_for_active() {' in source
    assert 'journalctl --user -u "$service" -n 50 --no-pager' in source
    assert 'readlink -f "/proc/$pid/cwd"' in source
    assert 'expected_pythonpath="$release_backend/src"' in source


def test_deploy_script_supports_codeload_source_releases() -> None:
    source = DEPLOY_SCRIPT.read_text(encoding="utf-8")

    assert 'source_dir=${DEPLOY_SOURCE_DIR:-}' in source
    assert 'source release has an unexpected commit' in source
    assert 'cp -a "$source_dir"/. "$release_dir"/' in source


@pytest.mark.skipif(posix_shell() is None, reason="POSIX bash is required (set WUTONG_ENABLE_SHELL_TESTS=1 on Windows)")
def test_start_service_prefers_release_src_on_pythonpath(tmp_path: Path) -> None:
    backend = tmp_path / "backend"
    scripts = backend / "scripts"
    python_bin = backend / ".venv" / "bin" / "python"
    capture = tmp_path / "pythonpath.txt"
    scripts.mkdir(parents=True)
    python_bin.parent.mkdir(parents=True)
    (backend / "src").mkdir()
    shutil.copy2(SCRIPT, scripts / SCRIPT.name)
    (scripts / SCRIPT.name).chmod(0o755)
    python_bin.write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s' \"${PYTHONPATH:-}\" > \"$PYTHONPATH_CAPTURE\"\n",
        encoding="utf-8",
    )
    python_bin.chmod(0o755)

    environment = os.environ.copy()
    environment["PYTHONPATH_CAPTURE"] = str(capture)
    environment["PYTHONPATH"] = "/existing/project/src"
    result = subprocess.run(
        [
            "bash",
            str(scripts / SCRIPT.name),
            "agent_attack_lab.service:app",
            "8787",
        ],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    pythonpath = capture.read_text(encoding="utf-8").split(":")
    assert pythonpath[0] == str(backend / "src")
    assert "/existing/project/src" in pythonpath
