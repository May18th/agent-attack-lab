"""独立 AMP 心跳守护进程：不重启业务服务也能让智能体在平台保持在线。

适用场景
--------
- 三只 Agent 已经由 ``start.ps1`` / ``start-agents.ps1`` 跑起来，但那次启动没有开
  AMP（代码更新前启动的进程）。用这个脚本补心跳，无需重启业务。
- 只有心跳进程在跑、业务进程已死时不应该还显示在线，因此默认**先探活**：
  ``/health`` 不通就跳过本轮心跳。

用法（在 backend 目录）::

    .venv\\Scripts\\python.exe scripts\\run_amp_heartbeat.py
    .venv\\Scripts\\python.exe scripts\\run_amp_heartbeat.py --role attacker --no-probe
    .venv\\Scripts\\python.exe scripts\\run_amp_heartbeat.py --interval 15 --once

AIC 来自 ``agent-identities.json``；可用 ``AGENT_AMP_AIC`` 覆盖单个角色。
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from agent_attack_lab import amp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("amp.heartbeat.cli")

# 与本项目启动脚本的默认端口一致，用于"业务真的在跑才发心跳"。
PROBE_URLS = {
    "leader": "http://127.0.0.1:8787/health",
    "attacker": "http://127.0.0.1:8788/health",
    "defender": "http://127.0.0.1:8789/health",
}


def probe(client: httpx.Client, url: str) -> tuple[bool, str]:
    try:
        response = client.get(url)
    except Exception as exc:  # noqa: BLE001 - 探活失败只代表本轮跳过心跳
        return False, f"{url} 不可达：{exc}"
    if response.status_code != 200:
        return False, f"{url} 返回 HTTP {response.status_code}"
    return True, url


async def run(args: argparse.Namespace) -> int:
    identities = amp.load_identities()
    roles = args.role or ["leader", "attacker", "defender"]
    brokers = os.getenv("AGENT_AMP_KAFKA_BROKERS", "").strip() or amp.DEFAULT_BROKERS
    topic = os.getenv("AGENT_AMP_TOPIC", "").strip() or amp.DEFAULT_TOPIC
    heartbeats: list[amp.AmpHeartbeat] = []
    for role in roles:
        aic = identities.get(role)
        if not aic:
            logger.error("跳过 %s：agent-identities.json 中没有该角色的 AIC", role)
            continue
        heartbeats.append(
            amp.AmpHeartbeat(
                amp.AmpIdentity(role=role, aic=aic),
                brokers=brokers,
                topic=topic,
                interval_seconds=args.interval,
            )
        )
    if not heartbeats:
        logger.error("没有可上报的心跳目标")
        return 2

    logger.info(
        "开始上报 %d 只：%s（间隔 %.0fs%s）",
        len(heartbeats),
        ", ".join(f"{hb.identity.role}={hb.identity.aic}" for hb in heartbeats),
        args.interval,
        "" if args.no_probe else "，先探活",
    )

    try:
        with httpx.Client(timeout=4.0, trust_env=False) as client:
            round_no = 0
            while True:
                round_no += 1
                for heartbeat in heartbeats:
                    role = heartbeat.identity.role
                    if not args.no_probe:
                        healthy, detail = await asyncio.to_thread(
                            probe, client, args.probe_url.get(role, PROBE_URLS[role])
                        )
                        if not healthy:
                            logger.warning(
                                "%s 业务未就绪，跳过本轮心跳（%s）", role, detail
                            )
                            continue
                    try:
                        await heartbeat.emit_once()
                        logger.info("%s 心跳已发送（第 %d 轮）", role, round_no)
                    except Exception:
                        logger.warning("%s 心跳发送失败", role, exc_info=True)
                if args.once:
                    break
                await asyncio.sleep(args.interval)
    finally:
        for heartbeat in heartbeats:
            await heartbeat.stop()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--role", action="append", default=[], help="可重复：leader/attacker/defender"
    )
    parser.add_argument("--interval", type=float, default=15.0)
    parser.add_argument("--once", action="store_true", help="只发一轮（用于验证）")
    parser.add_argument(
        "--no-probe", action="store_true", help="跳过业务探活，强制上报"
    )
    parser.add_argument(
        "--probe-url",
        action="append",
        default=[],
        metavar="ROLE=URL",
        help="覆盖探活地址，例如 attacker=http://127.0.0.1:8788/health",
    )
    args = parser.parse_args()
    args.probe_url = {}
    for item in args.probe_url:
        role, _, url = item.partition("=")
        if role and url:
            args.probe_url[role.strip()] = url.strip()
    try:
        return asyncio.run(run(args))
    except KeyboardInterrupt:
        logger.info("已停止 AMP 心跳")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
