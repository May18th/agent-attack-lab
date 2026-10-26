import os

import pytest

os.environ.setdefault("AGENT_BATTLE_DB", ":memory:")

from agent_attack_lab import state
from agent_attack_lab.storage import BattleStore


@pytest.fixture(autouse=True)
def reopen_closed_test_store():
    """Keep module-level TestClients usable after a lifespan test closes its store."""
    if getattr(state.battle_store, "_closed", False):
        state.battle_store = BattleStore(":memory:")


@pytest.fixture(autouse=True)
def reset_public_battle_rate_limit():
    state.public_battle_rate_windows.clear()
