# 技术证据包（供材料撰写直接引用）

更新时间：2026-10-25 20:50
适用：写答辩材料、PPT、演示脚本的人直接引用；本文只放**已实测**的技术事实与复现命令，不含规划、预估或推测。

> 使用约定：引用时保留"实测值 + 复现命令"两样。任何没有出现在本文的数字都不要写进材料。

---

## 一、系统一句话（可直接用）

智能体攻防实验室是一个基于开源 ACPs SDK 二次开发的多智能体系统，由 1 个 Leader 调度智能体与攻击、防守 2 个 Partner 智能体组成，通过 AIP JSON-RPC 与 mTLS 双向认证互联，在梧桐平台上可被发现与调用。用户提交主题与难度后，Leader 编排攻击智能体生成合成测试样本、防守智能体给出证据型风险检出与修复建议、独立仲裁智能体出具裁决，最终输出带完整调用追溯的战报。

## 二、架构（文字版，供画图）

| 角色 | 端口 | 平台身份 | 端点 |
|---|---|---|---|
| Leader 主调度 | 8787 | AIC 尾号 `1A7Q`（ACPs 1.2.1） | `https://leader-mtls.yuanyiagentzhandui.cn/rpc` |
| 攻击智能体 | 8788 | AIC 尾号 `0MVE` | `https://attack.yuanyiagentzhandui.cn/rpc` |
| 防守智能体 | 8789 | AIC 尾号 `0GFQ` | `https://defense.yuanyiagentzhandui.cn/rpc` |

> AIC 口径（2026-10-26 01:05 复核，**已实测三方一致**）：以上为当前生效值，与平台 Discovery 返回值、`backend/agent-identities.json`、心跳上报值三者一致。
>
> **主调度在 2026-10-26 01:03 从 1.2.0 的 `0U7Q` 切到 1.2.1 的 `1A7Q`**，原因是 1.2.0 的 endpoint 是 `api.yuanyiagentzhandui.cn/rpc`，而该路径强制校验后端 `AGENT_API_KEY`——平台 AIP 调用不携带我们的私有 key，会被 401 挡住（旧身份「在线但调不通」）。1.2.1 走独立 mTLS 入口 `leader-mtls`，无客户端证书 403、有客户端证书 200，且由 nginx 在 mTLS 通过后注入内部 key，做到「在线且调用层可用，同时服务端身份可校验」。切换后 `0U7Q` 已于 17:04 前后掉线（Discovery 缺省 `alive=online` 查询返回空）。
>
> 此前材料中出现的 `09CQ` / `08RN` / `09SG`（以及更早的 `S5AJC0` / `QY650M`）均为历史轮次注册值，**已失效，不要写进材料**。

数据流：

```
用户/前端 → Leader(8787) → AIP JSON-RPC + mTLS → 攻击 Agent(8788)
                                    ↘           → 防守 Agent(8789)
                          ← 聚合样本 / 命中 / 风险 / 修复建议
                          → 仲裁 Agent（主服务内，独立复核）
                          → 战报（模型生成摘要）
                          → 事件流（correlationId 贯穿每次调用）
```

三个可讲的架构点：

1. **四路模型分工**：攻击生成、防守检测、仲裁裁决、战报摘要各用独立 prompt 与角色配置，任一路失败都可单独降级，不影响其它三路。
2. **两套字段互补**：`agentMode` 由 Agent 自报"我这次用的是模型还是规则"，`agentSource` 由 Leader 记录"我是怎么调到它的"。两者同时存在才能区分"Leader 调通了 ACP"和"Agent 内部真的用了模型"。
3. **证据门槛**：仲裁不接受纯文本命中作为攻击成功依据，要求 `targetVerified` 且带验证模式与证据，否则只能判 `undetermined` 并要求人工复核。

## 三、四路模型证据（核心）

实测时间 2026-10-26 01:41，用生产环境真实战局 `A-011`（`battle-67635f72-89f4-496c-9b13-0578eda250ae`，主题「客服机器人泄露内部系统提示词」，high，3 轮，耗时 16.5 秒）：

| 通路 | 字段 | 实测值 |
|---|---|---|
| 攻击样本生成 | `attackerOut.agentSource` | `acp-llm` |
| 防守检测 | `defenderOut[0].agentSource` | `acp-llm` |
| 防守检测模式 | `defenderOut[0].agentMode` | `llm` |
| 防守分析说明 | `defenderOut[0].analysisMode` | `DeepSeek 模型辅助分类 + OWASP LLM Top 10 (2025)；真实目标未验证` |
| 独立仲裁 | `defenderOut[0].arbiterReview.agentSource` | `arbiter-llm` |
| 战报摘要 | `summary.agentSource`（`GET /reports/{id}`） | `report-llm` |

复现方式（注意口径差异）：

```powershell
# 战局主体：公开只读，不用登录
curl.exe -s --noproxy "*" https://api.yuanyiagentzhandui.cn/battles/battle-67635f72-89f4-496c-9b13-0578eda250ae
```

`/reports/{id}` 需要看板凭据或 `X-API-Key`（`read_auth_dependency`），**不能对外说"无需登录"**。四路来源的自查走录屏前验收工作流，它读的是生产 `.env` 里的 key：

```powershell
gh workflow run predemo-healthcheck.yml --ref main -f battle="A-011" -f strict_sources="yes"
```

> 2026-10-26 01:31 首次跑这局时，战报这一路是 `report-rule-fallback`，其余三路都是 `-llm`。根因与修法见 §五「四个真问题」的第 4 条。修完重跑才是上表的值——**这条材料本身就是"我们发现并修掉了一个静默降级"的证据，不要藏起来**。

## 四、鲁棒性证据（答辩必问：模型挂了怎么办）

2026-10-25 20:35 实测三个场景，三路 Agent 同时验证：

| 场景 | 构造方式 | attacker | defender | arbiter | 是否抛异常 |
|---|---|---|---|---|---|
| 正常 | 真实 DeepSeek 端点 | `agentMode=llm` | `llm` | `arbiter-llm` | 否 |
| 模型端点不可达 | base_url 指向 `127.0.0.1:1`，超时 1s，不重试 | `local-rule-fallback` | `local-rule-fallback` | `arbiter-rule-fallback` | **否** |
| 密钥失效 | 端点正常，返回 HTTP 401 | `local-rule-fallback` | `local-rule-fallback` | `arbiter-rule-fallback` | **否** |

可讲的结论：模型是**增强**而非**依赖**。模型不可用时系统整体退回确定性规则，战局仍能跑完并落库，不会卡住或 500。

## 五、平台可见性证据

梧桐 Discovery 缺省只返回存活为 online 的智能体（不带 `extFilter`）：

```powershell
curl.exe -s --noproxy "*" -X POST https://wt.ioa.pub/discovery/acps-adp-v2/discover `
  -H "Content-Type: application/json" `
  -d "{\"type\":\"filtered\",\"limit\":5,\"filter\":{\"conditions\":[{\"field\":\"name\",\"op\":\"contains\",\"value\":\"智能体攻防实验室\"}]}}"
```

2026-10-25 实测：缺省参数命中 **3 条**，三只 AIC 齐全。

机制：平台存活状态来自 AMP 心跳（Kafka `wt.ioa.pub:19092`，主题 `amp.heartbeat`），不是 ACS 里的 `active` 声明。三只 Agent 由生产环境 systemd 服务各自上报，角色按启动模块区分。

### 心跳不依赖演示机（关键证据，2026-10-25 21:12 实测）

演示最大的翻车风险是"心跳跑在演示笔记本上，机器一休眠平台就查不到"。实测已排除：

| 时刻（UTC） | 本机 8787/8788/8789 | 平台缺省查询命中 |
|---|---|---|
| 12:47:54 | 全部停止 | 3 条（心跳尚未过期） |
| 12:49:21 | 全部停止 | **0 条** |
| 13:06–13:08 | 全部停止 | 0 条（生产当时缺心跳代码/依赖） |
| **13:12:36** | **全部停止** | **3 条** |
| 13:13:41（复查） | 全部停止 | 3 条，AIC 尾号 `09CQ` / `08RN` / `09SG` |
| 15:57:43（后台服务自然结束 2h33m 后） | 零进程、三端口全 DOWN | **3 条**，AIC 尾号 `0U7Q` / `0MVE` / `0GFQ` |
| 17:05:03（主调度已切 1.2.1） | 零进程、三端口全 DOWN | **3 条**，AIC 尾号 `1A7Q` / `0MVE` / `0GFQ` |

结论可以这样讲：**关掉本机全部服务，平台仍显示三只在线**，心跳由 VPS 常驻服务独立上报。

验收脚本（已入库，可直接演示）：

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\verify_amp_alive.py
```

输出逐只打印 `[OK]` 与平台侧 `lastSeen` 时间，判定口径与平台首页"AIC 查询在线状态"一致。

**演示注意（实测踩到过）**：某只 AIC 停止上报心跳后，平台需要 **约 2–3 分钟**才把它从 `online` 摘掉。若刚重启过服务、或同时有旧心跳进程在跑，按名称搜会短暂返回 **5 条以上**（含历史轮次注册的旧 AIC，如 `09CQ` / `08RN` / `09SG`、`S5AJC0` / `QY650M`）。等 3 分钟再查即恢复 3 条；录屏前先跑一次上面的验收脚本确认是 3 条再开始录。

### 这条链路上修掉的四个真问题（可作为"工程严谨性"素材）

| 问题 | 症状 | 根因 |
|---|---|---|
| 心跳模块未入库 | 生产 `.env` 开关与角色注入都正确，却一次心跳都没发出 | `amp.py` 与 `service.py`/`common.py` 的 lifespan 挂载只存在于本机工作区 |
| 身份映射缺失且过期 | 解析不到 AIC 时静默返回 `None`，只留一条 warning | `agent-identities.json` 未入库；且攻击/防守 AIC 仍是上一轮注册的旧值 |
| 依赖未安装 | 日志 `未安装 kafka-python，AMP 心跳只写本地 NDJSON` | `kafka-python` 只写进了本机 `pyproject`，VPS 的 venv 由部署流程之外创建，部署脚本也不装依赖 |
| 战报校验过严导致整份降级 | `AGENT_REPORT_LLM_ENABLED=1`、配置齐全，`agentSource` 却是 `report-rule-fallback` | 战报校验要求 `evidence` **每一条**都逐字出现在样本里，用的是全有全无判断；模型只要有 1 条改写成同义句，整段总结连同其余可核对证据一起被丢弃（`A-011` 实测：5 条里 4 条合规，1 条改写，整份判废） |

前三个的共同特征：**本机看起来完全正常，只有把本机关掉才暴露**。现在部署脚本会在重启前幂等补齐 `kafka-python`（已装则跳过），干净环境实测同样可用。

第四个与仲裁早先那次是同一类缺陷——把"字段级严格"当成"整份判废"。现在两处都改成**逐条剔除**：保留能核对的部分，丢掉不合格的，并打一条 `logger.warning` 说明剔了几条。防伪造属性不变（留下的证据仍必须逐字可核对），但不再因为一句话的措辞丢掉整次模型产出。全部伪造时强制 `needsHumanReview=true`。

## 六、可引用的量化指标

| 指标 | 值 | 来源 |
|---|---|---|
| 后端接口数 | 39 个（其中 29 个进 OpenAPI schema） | `APIRoute` 实测计数 |
| 后端测试 | 206 passed / 5 skipped | `pytest -q`，2026-10-25 |
| 前端测试 | 185 vitest + 5 node --test | 2026-10-24 基线 |
| 生产部署耗时 | 20 秒（run `40193395694`） | GitHub Actions 实测 |
| 干净环境部署 | 空目录克隆 → `uv sync --frozen` → `start.ps1` → 三服务 200、战局 completed、平台 3/3 在线，全程约 4 分钟 | `docs/CLEAN_DEPLOY_VERIFICATION.md` |
| 单次战局事件数 | 低/中/高难度分别 10 / 13 / 16 条 | 隔离环境验收记录 |
| 代码规模 | 后端 src 约 8000 行，前端 src 约 8200 行 | 2026-10-25 统计 |

## 七、边界声明（材料里**不要**写的话）

写材料时容易越界，以下说法没有证据支撑，不要出现：

| 不要写 | 原因 |
|---|---|
| "已修复客户系统漏洞" / "完成漏洞修复" | 防守侧只给**建议**，没有对真实目标做修复复测 |
| "检测准确率 XX%" / "攻击成功率 XX%" | 没有标注数据集与人工核验，样本是受控合成演示 |
| "模型调用量 XX 次" | 只有战局内计数，没有供应方遥测 |
| "平台访问量 XX" | 必须用平台侧报表数据，不能用本项目战局数替代 |
| "已接入客户生产环境" / "服务 N 家企业" | 无外部客户 |
| 把 `agentSource=acp-llm` 说成"模型准确率高" | 它只证明这次调用走的是模型，不证明结果正确 |

可以说的是：这是**授权范围内的受控演示系统**，样本为合成文本、不执行、不攻击真实目标，所有结论都带"真实目标未验证"的限定。

## 八、演示脚本要点（录屏用）

按这个顺序录，每段都有画面证据：

1. **平台发现**（约 30 秒）：梧桐平台首页输入 AIC 查在线状态 → 显示"在线"；再按名称搜，三只齐全。
2. **互联调用**（约 60 秒）：创建一场 `high` 难度、5 轮战局，说明这是 Leader 通过 AIP 调起两个 Partner。
3. **过程可追溯**（约 60 秒）：打开战局详情，展示每轮的 `correlationId`、调用耗时、`agentSource`。
4. **结果可读**（约 60 秒）：展示仲裁裁决（含 `undetermined` 时要求人工复核的理由）、防守命中证据是样本原文片段、修复建议。
5. **鲁棒性**（约 30 秒，可选）：说明模型不可用时自动降级，不要现场制造故障。

录制注意：
- 演示前 30 分钟确认平台仍显示 3 条在线；
- 不要现场删战局、不要改配置；
- 画面里出现密钥的窗口一律关掉。
