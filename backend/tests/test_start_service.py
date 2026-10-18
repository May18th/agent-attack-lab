from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts" / "start-service.sh"


def test_start_service_adds_release_src_to_pythonpath() -> None:
    source = SCRIPT.read_text(encoding="utf-8")

    assert 'export PYTHONPATH="$PWD/src${PYTHONPATH:+:$PYTHONPATH}"' in source


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash is required")
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
