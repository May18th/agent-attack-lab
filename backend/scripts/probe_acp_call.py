"""Probe: call attack agent AIP RPC directly to capture the exact identity error."""

import asyncio
import json
import ssl
import sys
import traceback

from acps_sdk.aip import AipRpcClient

BASE = r"C:/Users/15984/WorkBuddy/2026-10-30-01-48-33/agent-attack-lab/backend/.acps-cli/certs"
LEADER_CERT_DIR = BASE + r"/1_2_156_3088_1_BUPT_RX2TMW_KOPA19_GA39CB_1A7Q/clientAuth"

LEADER_AIC = "1.2.156.3088.1.BUPT.RX2TMW.KOPA19.GA39CB.1A7Q"
ATTACKER_AIC = "1.2.156.3088.1.BUPT.RX2TMW.IE3B57.C2049I.0MVE"
ATTACKER_URL = "https://attack.yuanyiagentzhandui.cn/rpc"


def make_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context(cafile=LEADER_CERT_DIR + "/trust-bundle.pem")
    ctx.load_cert_chain(
        certfile=LEADER_CERT_DIR + "/agent-cert.pem",
        keyfile=LEADER_CERT_DIR + "/agent-key.pem",
    )
    return ctx


async def probe(binding: bool) -> None:
    client = AipRpcClient(
        partner_url=ATTACKER_URL,
        leader_id=LEADER_AIC,
        ssl_context=make_context(),
        expected_partner_aic=ATTACKER_AIC if binding else None,
        identity_binding_enabled=binding,
    )
    try:
        task = await client.start_task(
            session_id="probe-session-1",
            user_input=json.dumps(
                {"difficulty": "mid", "topic": "提示注入"},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        )
        state = task.status.state
        state = state.value if hasattr(state, "value") else state
        print(f"[binding={binding}] start_task OK, state={state}")
    except Exception as exc:
        print(f"[binding={binding}] FAILED: {type(exc).__name__}: {exc}")
        if binding:
            traceback.print_exc()
    finally:
        await client.close()


async def main() -> None:
    await probe(binding=True)
    await probe(binding=False)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
