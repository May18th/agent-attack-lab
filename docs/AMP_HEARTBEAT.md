# AMP 心跳：让智能体在梧桐平台"在线"可查

更新时间：2026-10-25（已实测打通）

## 1. 问题与根因

现象：三只智能体已在梧桐注册并通过审核（`active=true`），但在平台上查不到——
首页「输入 AIC 查询在线状态」显示查不到、按名称/ID 搜索 0 条、「活跃智能体」计数里没有我们。

根因（2026-10-25 对生产 Discovery 实测）：

1. Discovery v2.2 的缺省过滤不只是 `active=true` + `visibility=public`，还叠加了
   `extFilter` 的 **`alive=["online"]`**（出厂 `DISCOVERY_DEFAULT_ALIVE_STATES`）。
2. 存活状态不来自 ACS 声明，只来自 AMP 心跳链路。我们从注册起从未上报过心跳，
   存活状态是 `unknown`（"从未被观测到"），于是被缺省过滤掉。
3. 实测对照：同一个 AIC，默认参数查 0 条；把 `alive` 放开到
   `online/offline/unknown` 立刻返回 1 条；手工发一条 Kafka 心跳后，默认参数直接命中。

```
Agent 进程 ──HeartbeatEmitter──▶ 本地 amp_heartbeat_<role>.jsonl
                                        │
                    （Fluent Bit 或本项目内置直投）
                                        ▼
                 Kafka wt.ioa.pub:19092 / 主题 amp.heartbeat
                                        ▼
                      平台 alive-sync（hb 分片）→ aliveMap
                                        ▼
        Discovery 缺省查询 / 首页 AIC 查询 / 活跃智能体计数
```

## 2. 实现位置

| 文件 | 作用 |
| --- | --- |
| `backend/src/agent_attack_lab/amp.py` | 心跳记录生成（AMP schema 1.0）、NDJSON 落盘、Kafka 直投、失败降级 |
| `backend/agent-identities.json` | role → AIC 映射（公开身份，不含凭据） |
| `backend/scripts/amp-env.ps1` | 启动脚本共用的环境变量注入 |
| `backend/scripts/run_amp_heartbeat.py` | 独立心跳守护进程（不重启业务也能补心跳） |
| `backend/scripts/verify_amp_alive.py` | 按平台缺省口径验收在线状态 |
| `backend/tests/test_amp_heartbeat.py` | 离线契约测试（不访问平台） |

心跳已接入两处进程生命周期：

- 主调度 Agent（`service.py` 的 lifespan，角色 `leader`）
- 独立攻击/防守 Agent（`agents/common.py` 的 lifespan，角色 `attacker` / `defender`）

## 3. 怎么开启

### 本机（推荐）

```powershell
cd D:\梧桐\backend
.\restart.ps1          # 内含 stop/start agents，并为三个进程注入 AMP 变量
```

`start.ps1` / `restart.ps1` / `start-agents.ps1` 都会调用 `scripts\amp-env.ps1`，
自动设置 `AGENT_AMP_ENABLED=1`、按角色取 AIC、写日志到 `backend\.data\amp\`。
想临时关掉：`$env:AGENT_AMP_ENABLED='0'` 后再执行脚本。

### 不重启业务（补心跳）

```powershell
.venv\Scripts\python.exe scripts\run_amp_heartbeat.py --interval 15
```

默认先探活（8787/8788/8789 的 `/health`），业务不在就不发心跳，避免"假在线"。

### 生产（VPS）

在 VPS 的 `.env` 中加：

```env
AGENT_AMP_ENABLED=1
AGENT_AMP_ROLE=leader          # 攻击/防守进程各自设为 attacker / defender
AGENT_AMP_KAFKA_BROKERS=wt.ioa.pub:19092
AGENT_AMP_TOPIC=amp.heartbeat
AGENT_AMP_INTERVAL_SECONDS=15
```

重启服务后生效。Kafka 是 PLAINTEXT（平台对外上报端点），无需证书。

## 4. 验收

```powershell
cd D:\梧桐\backend
.venv\Scripts\python.exe scripts\verify_amp_alive.py --wait 60
```

判定口径与平台一致：请求**不带** `extFilter`（即平台缺省 `alive=online`），
能命中且 `aliveMap[aic].alive == true` 才算通过。2026-10-25 实测三只全部 `在线`。

其他可核对项：

- 本地 `backend\.data\amp\amp_heartbeat_*.jsonl` 行数持续增长（约每 15s 一行）
- `https://wt.ioa.pub/discovery/admin/alive-sync/status` 的 `knownCount`/`aliveCount` 包含我们的 AIC
- 平台首页「输入 AIC 查询在线状态」显示"· 在线"

## 5. 边界与注意事项

- **心跳只证明"某处有进程在跑"**。本机进程和 VPS 进程用同一个 AIC，本机在跑时平台
  也会显示在线。若要求"只有 VPS 在线才算在线"，只在 VPS 开启 AMP，本机保持
  `AGENT_AMP_ENABLED=0`。
- 心跳一停，存活状态会在平台 TTL 后转为 offline/unknown，重新回到"查不到"。
  因此心跳必须和业务进程一起常驻（已接入 lifespan），而不是一次性脚本。
- 心跳不解决两类列表的可见性：
  - 首页「最新智能体」（`type=recent`）：按 ACS `lastModifiedTime` 倒序。**2026-10-25 23:58
    复测已能搜到**（三只分别排在最近 10 条的第 3、5、6 位），因为 1.2.0 重新注册刷新了
    `lastModifiedTime`；此前"ACS 停在 2026-10-11、排不上"的结论已失效。
  - 「热门智能体 / 调用排行榜」（`type=trending`、`/api/rankings/top`）：按真实调用量，
    需要实际发生 AIP 调用并上报 AMP access 日志。
- 未安装 `kafka-python` 时，`amp.py` 只写本地 NDJSON，需要再用官方 Fluent Bit 方案
  尾追转发（配置见 `https://wt.ioa.pub/amp`）。
- Kafka 连不上只记 warning，不影响业务请求；`AGENT_AMP_ENABLED` 默认 0，
  未配置的环境完全不受影响。
