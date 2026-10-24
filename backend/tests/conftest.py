import os

import pytest

os.environ.setdefault("AGENT_BATTLE_DB", ":memory:")

from agent_attack_lab import state


@pytest.fixture(autouse=True)
def reset_public_battle_rate_limit():
    state.public_battle_rate_windows.clear()
