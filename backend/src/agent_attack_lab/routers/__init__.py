"""HTTP routers, grouped by domain.

Each module owns one slice of the API and exposes ``router``. They import only
lower-level modules (config / state / security / models / ...) and never
``service``, which is what keeps ``service.py`` free to include them.
"""

from __future__ import annotations

from agent_attack_lab.routers import auth, meta

__all__ = [
    "auth",
    "meta",
]
