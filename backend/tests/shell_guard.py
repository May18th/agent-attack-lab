"""Guard for tests that spawn a POSIX shell.

On Windows, ``shutil.which("bash")`` usually resolves to the WSL launcher.
Running it can hard-crash the test process when WSL is unavailable or blocked
(for example by a sandbox policy), and a hard crash bypasses pytest's skip
machinery entirely.

Treat the shell as unavailable on Windows unless the caller opts in explicitly
with ``WUTONG_ENABLE_SHELL_TESTS=1``.
"""

from __future__ import annotations

import os
import shutil
import sys


def posix_shell() -> str | None:
    """Return a usable POSIX shell path, or None when tests must be skipped."""
    bash = shutil.which("bash")
    if not bash:
        return None
    if sys.platform == "win32" and os.getenv("WUTONG_ENABLE_SHELL_TESTS") != "1":
        return None
    return bash
