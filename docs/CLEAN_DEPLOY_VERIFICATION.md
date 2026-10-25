# 干净环境一键部署实测记录

实测时间：2026-10-25 21:14–21:18（本机时间）
被测提交：`d12444d`（`fix(start): 启动脚本补上 AMP 角色注入`）
用途：对应评审"附加分"里"一键部署须在干净环境实测"这一条，作为可核验记录。

---

## 一、测试方法与边界

做法：把仓库**已提交的状态**克隆到一个空目录，再严格按 `README.md` 的说明走一遍。

- 克隆源：本地仓库当前提交（等价于 `git clone` 之后的远端内容）
- 起点不含：`.venv`（虚拟环境）、`.data`（数据库与日志）、`.env`（密钥配置）——这三类都在 `.gitignore` 里
- 判定标准：三个服务健康检查返回 200、能跑完一场战局、三只智能体在平台显示在线

**边界说明（写材料时请照实描述）**：这是**同一台机器上的空目录**，不是另一台物理机；环境为 Windows 11 + Python 3.13。它验证的是"仓库里提交的东西是否自足"，不验证跨操作系统行为。

---

## 二、步骤与结果

| # | 步骤 | 命令 | 结果 |
|---|---|---|---|
| 1 | 克隆到空目录 | `git clone <repo> .tmp-clean-deploy/repo` | 成功，`HEAD = d12444d` |
| 2 | 关键文件齐全性 | 逐个检查 6 个入口文件 | 6/6 存在（`agent-identities.json`、`amp.py`、`amp-env.ps1`、`start-service.sh`、`uv.lock`、`verify.ps1`） |
| 3 | 安装依赖 | `uv sync --frozen` | 成功，含 `kafka-python 3.0.11` |
| 4 | 按 README 启动 | `.\start.ps1` | 三只服务起来，日志显示三个 AMP 角色均已注入 |
| 5 | 健康检查 | `GET /health` × 3 | 8787 / 8788 / 8789 全部 **200** |
| 6 | 跑一场战局 | `POST /battles` | `completed`，无 `.env` 时按预期走规则兜底（`agentMode=local-rule`、`arbiter-rule-fallback`） |
| 7 | 心跳是否上报 | 查 `.data/amp/*.jsonl` | 三个角色各有一条，AIC 正确 |
| 8 | 平台在线验收 | `scripts\verify_amp_alive.py` | **3/3 `[OK]` 在线**，带回平台侧 `lastSeen` |

第 8 步的实际输出：

```
[OK  ] leader / 智能体攻防实验室-主调度智能体   aic=...34O5X3.KXMH76.09CQ  在线
[OK  ] attacker / 智能体攻防实验室-攻击智能体   aic=...LMB4VK.NJ99P0.08RN  在线
[OK  ] defender / 智能体攻防实验室-防守智能体   aic=...KYUDTI.BI8UKQ.09SG  在线
全部在线：平台缺省查询（含首页 AIC 在线状态查询）可命中。
```

> 上表 AIC 为**当次实测时的值**（1.2.0 重新注册前）。此后三只 ACS 已随重新注册换发：主调度 2026-10-26 起用 ACPs 1.2.1 的 `1A7Q`，攻击 `0MVE`、防守 `0GFQ` 不变。验收脚本读的是 `backend/agent-identities.json`，会自动取当前生效值，无需改脚本。

**结论：从零目录按 README 走一遍即可跑通，无需任何手工补文件。**

---

## 三、这次实测抓到的问题（都已修掉）

干净环境的价值就在这里——以下四个缺口在本机"一切正常"，只有换到空目录才暴露：

| 问题 | 本机表现 | 空目录/生产表现 |
|---|---|---|
| `amp.py` 与 lifespan 挂载未入库 | 正常（文件在本机） | 没有心跳代码，平台恒为 `unknown` |
| `agent-identities.json` 未入库、AIC 过期 | 正常（本机有心跳） | 解析不到身份，静默不发心跳 |
| `kafka-python` 只在未提交的 `pyproject` 里 | 正常（本机 venv 已装） | 只写本地 NDJSON，投递不到平台 |
| 三个启动脚本的 AMP 角色注入未入库 | 正常 | 起了服务但不上报心跳 |

另外发现：**部署脚本原本完全不安装依赖**，VPS 的 venv 是在部署流程之外创建的。现已在 `deploy-production.sh` 增加幂等的 `ensure_amp_dependency`（已装则跳过，未装则用 `uv pip` 补装，失败只告警不阻断服务）。

---

## 四、复现命令

```powershell
cd D:\梧桐
git clone . .tmp-clean-deploy\repo
cd .tmp-clean-deploy\repo\backend
uv sync --frozen
.\start.ps1                     # 保持运行，另开一个窗口做下面几步
Invoke-WebRequest http://127.0.0.1:8787/health -UseBasicParsing | Select-Object StatusCode
.\.venv\Scripts\python.exe scripts\verify_amp_alive.py
```

注意：`start.ps1` 会占用当前窗口（前台运行 uvicorn），验收要另开一个终端。

---

## 五、还没覆盖的部分

- **另一台物理机 / 另一种操作系统**：没测。若要写"跨机器可部署"，需要另找一台机器再跑一遍。
- **公网端到端**：本文只覆盖本地三服务；公网侧证据在 `TECH_EVIDENCE_PACK.md` 第三节与第五节。
- **无网络环境**：`uv sync` 需要拉依赖，离线部署未验证。
