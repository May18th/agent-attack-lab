"""Reject credentials and local-only artifacts from tracked or staged Git files."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

_BANNED_NAME = re.compile(
    r"(?:^|/)(?:\.env(?:\..*)?|.*\.(?:pem|key|crt|p12|pfx|whl|jsonl|sqlite3|db|log|bak))$",
    re.IGNORECASE,
)
_BANNED_DIR = re.compile(r"(?:^|/)(?:\.acps-cli|keyfiles|packages|\.data)(?:/|$)", re.IGNORECASE)
_PRIVATE_KEY = re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")


def violations(paths: list[str], root: Path, *, staged: bool = False) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    for raw_path in paths:
        relative = raw_path.replace("\\", "/").lstrip("./")
        if relative.lower().endswith((".env.example", ".env.sample", ".env.template")):
            continue
        path = root / Path(relative)
        if _BANNED_NAME.search(relative) or _BANNED_DIR.search(relative):
            findings.append({"path": relative, "reason": "local_or_sensitive_filename"})
            continue
        if staged:
            completed = subprocess.run(
                ["git", "show", f":{relative}"],
                cwd=root,
                capture_output=True,
                check=False,
            )
            content = completed.stdout.decode("utf-8", errors="ignore") if completed.returncode == 0 else ""
        elif path.is_file():
            try:
                content = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
        else:
            continue
        if _PRIVATE_KEY.search(content):
            findings.append({"path": relative, "reason": "private_key_material"})
    return findings


def git_paths(root: Path, staged: bool) -> list[str]:
    command = ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"] if staged else [
        "git", "ls-files"
    ]
    completed = subprocess.run(command, cwd=root, check=True, capture_output=True, text=True)
    return [line.strip() for line in completed.stdout.splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true", help="inspect the Git index instead of tracked files")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    findings = violations(git_paths(root, args.staged), root, staged=args.staged)
    if findings:
        print("发现禁止进入 Git 的文件：")
        for finding in findings:
            print(f"- {finding['path']}: {finding['reason']}")
        return 1
    print("敏感文件检查通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
