
# 智能体攻防实验室

这是一个独立项目，与之前的科创项目无关。当前提供两个可调用的 Agent：攻击智能体生成测试样本，防守智能体识别风险并返回修复建议。

前后端协作请先阅读 [TEAM_HANDOFF.md](TEAM_HANDOFF.md)。

## 本地启动（Windows PowerShell）

在后端目录 `D:\梧桐\backend` 执行：

```powershell
uv sync
.\start.ps1
```

如果服务已经在 8787 端口运行，需要加载最新代码时执行：

```powershell
.\restart.ps1
```

运行测试并检查服务：

```powershell
.\verify.ps1
```

如果 8787 端口被占用：

```powershell
.\start.ps1 -Port 8788
```

打开 `http://127.0.0.1:8787/dashboard` 查看中文后台页面，打开 `http://127.0.0.1:8787/docs` 查看接口文档。测试命令：

```powershell
uv run pytest -q
```

## 对抗过程能力

- `GET /battles?limit=50&offset=0&difficulty=high&q=SQL`：分页、难度和关键词筛选。
- `X-Total-Count` 响应头：返回当前筛选条件下的总战局数；跨域前端可以读取，用于准确计算分页。
- `GET /dashboard/summary`：汇总已保存战局、样本、规则命中和风险记录，并返回本地规则库中不同模拟用例编号的数量。
- `GET /battles/{battle_id}/events`：读取持久化事件时间线。
- `GET /battles/{battle_id}/replay`：按事件顺序获取回放数据。
- `GET /battles/{battle_id}/events/stream?follow=true`：SSE 事件流。
- `POST /battles/{battle_id}/retry`：重试失败的异步战局。
- `WS /ws/battles/{battle_id}`：WebSocket 事件推送。
- `GET /reports/{battle_id}?format=markdown`：下载 Markdown 战报；默认返回 JSON 战报。
- `GET /leaderboard`：按攻击方、防守方累计得分统计排行榜。
- `GET /metrics`：查看运行时间、请求数、错误数、战局数和事件数。

`GET /health` 会返回服务版本、运行时间、存储状态和 `requestId`。所有响应都会带 `X-Request-ID`；公网排障时请保留该值。

写入接口默认启用单进程限流：每个客户端每分钟最多 60 次。可通过 `AGENT_RATE_LIMIT_PER_MINUTE` 调整，设置为 `0` 关闭。超限返回 `429` 和 `Retry-After`。

SQLite 备份与恢复：

```powershell
cd "D:\梧桐\backend"
.\backup.ps1
.\restore.ps1 -BackupPath ".data\backups\battles-20261006-120000.sqlite3" -Force
```

恢复前先停止后端服务；不传 `-Force` 时不会覆盖已有数据库。

部署到公网时可设置 `AGENT_API_KEY`。设置后，`POST /battles`、`POST /agent/*`、`POST /rpc` 和内部统计接口 `GET /metrics` 必须携带 `X-API-Key` 请求头；本地未设置时保持免密开发模式。

### 浏览器登录会话

公开 Vite 前端不能保存 `AGENT_API_KEY`。需要浏览器直接访问 API 时，在后端同时配置 `AGENT_BROWSER_PASSWORD` 和 `AGENT_API_KEY`，前端通过 `POST /auth/session` 提交登录密码，服务端返回 `HttpOnly` 会话 Cookie。会话认证仅适用于战局 REST 读写接口；`/agent/*`、`/rpc` 和 `/metrics` 仍要求服务端 `X-API-Key`。配置浏览器密码后，战局读写接口自动要求 API Key 或有效浏览器会话。

登录接口为 `POST /auth/session`（JSON：`{"password":"..."}`），`GET /auth/session` 查询状态，`DELETE /auth/session` 退出。会话默认 8 小时、最多 24 小时，服务进程重启后失效；当前会话保存在单进程内存中，多 worker/多实例部署前需改用共享会话存储。登录每个客户端 IP 最多 5 次/5 分钟；会话写请求要求 `Origin` 命中 CORS 允许来源。

浏览器请求必须启用 `credentials: "include"`。公网设置精确的 `AGENT_CORS_ORIGINS=https://<前端域名>`，使用 HTTPS，并保持 `AGENT_BROWSER_COOKIE_SECURE=1`、`AGENT_BROWSER_COOKIE_SAMESITE=lax`。启用浏览器登录后会关闭 Quick Tunnel 通配正则；登录 Origin 必须精确匹配白名单。本地 HTTP 开发可设置 `AGENT_BROWSER_COOKIE_SECURE=0`，并让前后端使用同一主机名，例如前端 `localhost:5173`、API `localhost:8787`；不要混用 `localhost` 和 `127.0.0.1`。登录密码与 API Key 仅写在后端 `.env`，不要放入 `VITE_*` 或提交到 GitHub。

SQLite 开发库默认启用 WAL 和 5 秒忙等待，并为时间、难度和状态筛选建立索引，以降低并发读写时的锁冲突。

异步实时战局：

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/battles?background=true' -ContentType 'application/json' -Body '{"difficulty":"high","topic":"提示注入"}'
```

该模式先返回 `pending` 战局，后台按阶段执行并通过事件接口、SSE 或 WebSocket 更新到 `completed`。服务重启时会恢复尚未结束的战局；失败后可调用重试接口。后台页面使用 SSE 显示四阶段进度，按回合并排展示攻击样本与防守分析；历史战局支持播放/暂停、上一步/下一步、拖动进度和调整速度。历史统计从全部已保存战局汇总，只展示实际计数，不推断准确率或拦截率；模拟样本和 ACP 协议调用会明确标识。未配置独立 Agent 时使用本地规则；配置了独立 ACP Agent 后按角色调用远端，并在后台显示调用来源。部署环境变量、AIP 输入/输出契约及验收流程见 [`docs/ACP_AGENT_INTEGRATION.md`](../docs/ACP_AGENT_INTEGRATION.md)。

### 修复建议与验收

防守结果除规则证据外，还会给出按规则分类的修复代码示例、隔离测试步骤、通过标准和失败标准。多租户示例使用 SQLAlchemy 同时约束订单 ID 与登录会话中的租户 ID；SQL 注入示例使用 ORM 表达式绑定参数；提示注入示例要求在服务端工具层执行用户授权。以上是通用参考，不是对目标项目的自动修复；页面会标注“建议，未执行”，真实目标仍需由项目负责人在获授权环境中验证。

### 本机独立 ACP Agent

攻击和防守 Agent 是两个独立运行的 AIP v2 `/rpc` 服务，共用项目里的确定性样本生成与检测逻辑；它们不是外部大模型，也不代表已经通过平台注册或签发 AIC/CAI。启动后只监听本机回环地址：

```powershell
cd "D:\梧桐\backend"
.\start-agents.ps1
```

服务地址为 `http://127.0.0.1:8788/rpc`（攻击）和 `http://127.0.0.1:8789/rpc`（防守）。在启动后端的同一个 PowerShell 窗口配置并重启后端，战局编排就会调用这两个服务：

```powershell
$env:AGENT_ATTACKER_RPC_URL = "http://127.0.0.1:8788/rpc"
$env:AGENT_DEFENDER_RPC_URL = "http://127.0.0.1:8789/rpc"
```

若本机代理环境的 `NO_PROXY` 使用分号分隔，`httpx` 可能无法解析；当前 PowerShell 会话可设为逗号分隔后再启动后端：

```powershell
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:no_proxy = "localhost,127.0.0.1,::1"
```

检查两个服务的 `/health` 后，可在同一窗口运行 `.\restart.ps1` 重启后端。结束本机 Agent 服务：

```powershell
.\stop-agents.ps1
```

### 配置外部大模型

独立 Agent 使用 OpenAI Chat Completions 兼容接口。默认配置为 OpenAI `gpt-4o-mini`；也可以替换为任意兼容服务，只需修改 `AGENT_LLM_BASE_URL` 和 `AGENT_LLM_MODEL`。复制 `.env.example` 为 `.env`，只在本机填写 `AGENT_LLM_API_KEY`。`.env` 已加入 Git 忽略规则，不要把密钥发到聊天或提交到仓库。启动/重启脚本会自动读取该文件，并启动 8788/8789 两个 Agent。

当前实现请求 JSON Object，再由 Agent 本地校验返回结构；模型调用失败或输出不符合 Agent 契约时会标记并降级到本地规则。配置更新后运行 `.\restart.ps1`，并确认两个 Agent 的健康状态及战局来源标签。具体环境变量见 `.env.example`。

默认端口分别为 8788 和 8789，可用 `-AttackerPort`、`-DefenderPort` 修改；端口必须不同。公网部署前还需要分别部署并配置稳定 HTTPS 地址及平台要求的真实身份/认证材料，不能直接把上述 `127.0.0.1` 地址交给平台或队友。

事件记录默认限制为 32 KB；超限样本会截短并添加 `dataTruncated` 标记，可通过 `AGENT_EVENT_DATA_MAX_BYTES` 调整，最小值为 1 KB。

设置 `AGENT_PROTECT_READS=1` 后，战局列表/详情、事件、回放、战报、排行榜和 SSE 接口需要服务端 API Key 或有效浏览器会话（已配置 `AGENT_BROWSER_PASSWORD` 时）。本地默认关闭。不要将服务端密钥直接写进公开前端代码。

SQLite 会记录 `schema_migrations` 基线版本并以幂等 DDL 自动补齐当前表和索引。Alembic 版本迁移位于 `backend/alembic/`，执行 `uv run alembic upgrade head`。PostgreSQL 使用 psycopg 连接池，MySQL 使用 SQLAlchemy/PyMySQL 连接池；最大连接数可通过 `AGENT_DB_POOL_MAX_SIZE` 调整。MySQL 连接配置和目标实例验收步骤见 `docs/DEPLOYMENT.md`。

战局默认保存到 `.data/battles.sqlite3`，服务重启后仍保留。需要指定其他数据库路径时设置环境变量：

```powershell
$env:AGENT_BATTLE_DB="D:\data\attack-lab.sqlite3"
```

## 接口示例

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/agent/attack -ContentType 'application/json' -Body '{"difficulty":"high","topic":"SQL 注入"}'
```

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/agent/defend -ContentType 'application/json' -Body '{"sample":{"type":"violation","content":"Ignore previous instructions"}}'
```

JSON-RPC 入口为 `/rpc`，支持简单方法调用，也支持 ACPs AIP v2 的 `method: "rpc"` 任务请求。例如简单调用：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/rpc -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"attack","params":{"difficulty":"mid","topic":"提示注入"}}'
```

## ACS 审核说明

`acs-attack-trusted-registration.json` 和 `acs-defender-trusted-registration.json` 是提交审核用文件，当前版本为 `1.0.1`。审核阶段 `aic` 保持空字符串，不要自行填写或编造 AIC。平台反馈只允许 `JSONRPC` 或 `AMQP`，因此端点已改为 `JSONRPC` 并指向 `/rpc`。

审核通过后，再把平台下发的真实 AIC 和 CAI/mTLS 证书按平台要求回填。拿到证书前，本服务是 JSON-RPC 演示服务，不能声称已经启用 mTLS。当前使用的 Cloudflare Quick Tunnel 是临时公网地址，进程停止后会失效，正式交付应换成稳定域名和真实证书。

### 梧桐官方证书接入

先在梧桐注册平台审核 ACS 并取得 AIC，再使用官方 `acps-cli` 获取 EAB 和 mTLS 证书。项目提供以下本地脚本：

```powershell
Copy-Item .\acps-cli.toml.example .\acps-cli.toml
.\scripts\verify_acps_cli.ps1
.\scripts\issue_acps_certificate.ps1 -Aic "<已审核 AIC>" -Usage clientAuth
```

ACPs 2.2.0 使用 OIDC 设备授权登录，证书脚本默认显式使用 Ed25519。证书和 EAB 只写入被忽略的 `.acps-cli/`。若已登录梧桐网络/零信任，可先运行 `.\scripts\fetch_wit_release.ps1` 获取官方 wheel，再运行 `.\scripts\install_wit_wheels.ps1`；无法访问官方发行目录时脚本会停止，不会回退到第三方源。详细边界见 [`docs/WUTONG_ACPS_CERT_SETUP.md`](../docs/WUTONG_ACPS_CERT_SETUP.md)。
