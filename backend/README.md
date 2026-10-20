
# 智能体攻防实验室

这是一个独立项目，与之前的科创项目无关。当前提供两个可调用的 Agent：攻击智能体生成测试样本，防守智能体识别风险并返回修复建议。

前后端协作请先阅读 [TEAM_HANDOFF.md](TEAM_HANDOFF.md)。

## 本地启动（Windows PowerShell）

在后端目录 `D:\梧桐\backend` 执行：

```powershell
uv sync
.\start.ps1
```

`uv sync` 安装 GitHub CI 使用的公共 SDK 基线。生产梧桐部署还需将审核通过的
`acps_sdk-2.2.0`、`wit_framework-2.1.0` 和 `release-manifest.json` 放入
`backend/packages/`，再运行 `scripts/install_wit_wheels.ps1`；这些私有文件不提交 Git。

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
- `GET /battles/{battle_id}/audit`：只读审计事件序列、战局归属和来源完整性。
- `GET /battles/{battle_id}/replay`：按事件顺序获取回放数据。
- `GET /battles/{battle_id}/events/stream?follow=true`：SSE 事件流。
- `POST /battles/{battle_id}/retry`：重试失败的异步战局。
- `WS /ws/battles/{battle_id}`：WebSocket 事件推送。
- `GET /reports/{battle_id}?format=markdown`：下载 Markdown 战报；默认返回 JSON 战报。
- `GET /battles/{battle_id}/score`、`GET /internal-scores?limit=50`：分别查看攻击 Agent 和防守 Agent 的内部评分与近期均分；这不是比赛评分或检测准确率。规则见 [`docs/INTERNAL_SCORING.md`](../docs/INTERNAL_SCORING.md)。
- `GET /leaderboard`：按攻击方、防守方累计得分统计排行榜。
- `GET /metrics`：查看运行时间、请求数、错误数、战局数和事件数。

管理员后台的事件回放接口字段、游标分页、访问控制边界和 3D 模型资源清单见 [`docs/ADMIN_3D_REPLAY.md`](../docs/ADMIN_3D_REPLAY.md)。

`GET /health` 会返回服务版本、运行时间、存储状态和 `requestId`。所有响应都会带 `X-Request-ID`；公网排障时请保留该值。

写入接口默认启用单进程限流：每个客户端每分钟最多 60 次。可通过 `AGENT_RATE_LIMIT_PER_MINUTE` 调整，设置为 `0` 关闭。超限返回 `429` 和 `Retry-After`。

SQLite 备份与恢复：

```powershell
cd "D:\梧桐\backend"
.\backup.ps1
.\restore.ps1 -BackupPath ".data\backups\battles-20261006-120000.sqlite3" -Force
```

恢复前先停止后端服务；不传 `-Force` 时不会覆盖已有数据库。

部署到公网时应设置 `AGENT_API_KEY`。公开网站所需的业务 API 无需该密钥；`POST /agent/*`、`POST /rpc` 和内部统计接口 `GET /metrics` 始终需要服务端 API Key。

### 浏览器组织认证（Cloudflare Access）

公开前端不要求组织认证。若使用 Cloudflare Access，应仅保护后台管理页和内部接口，不要在前端静态资源或公开业务 API 上配置强制登录策略。后端配置 `CF_ACCESS_TEAM_DOMAIN` 和 `CF_ACCESS_AUDIENCE` 后，会对受保护路由校验 Cloudflare 注入的 `Cf-Access-Jwt-Assertion`（JWKS、issuer、audience、过期时间）。

```text
CF_ACCESS_TEAM_DOMAIN=https://<team-name>.cloudflareaccess.com
CF_ACCESS_AUDIENCE=<Access application AUD tag>
```

`CF_ACCESS_TEAM_DOMAIN` 与 `CF_ACCESS_AUDIENCE` 必须同时配置；不要把任何 Access token、API Token 或
服务端 API Key 放入 `VITE_*` 或提交到 GitHub。正式部署仍应配置服务端 `AGENT_API_KEY`，供 `/agent/*`、`/rpc`、`/metrics` 和管理接口使用；`/health` 及公开业务 API 可供公众访问。

### 兼容的浏览器登录会话

公开 Vite 前端不要求登录，且不能保存 `AGENT_API_KEY`。公开业务接口包括战局创建、列表与详情、统计摘要和外部案例查询；创建战局默认每客户端每分钟最多 10 次，可用 `AGENT_PUBLIC_BATTLE_LIMIT_PER_MINUTE` 调整。该限流保存在单进程内存中，多 worker/多实例部署还应在入口代理配置限流。反向代理必须覆盖 `X-Real-IP` 为实际客户端地址，后端仅在请求来自 loopback 代理时信任该头。

后台 HTML 页面 `/dashboard`、战局重试/删除、审计/报告/事件回放/SSE，以及 `/agent/*`、`/rpc` 和 `/metrics` 继续使用后端认证。配置 `AGENT_BROWSER_PASSWORD` 后，未登录访问 `/dashboard` 会跳转到同源 `/login` 页面；登录成功后回到原页面，并建立 HttpOnly 会话。公开前端保持免登录，不能接收或保存后台密码。内部 API 仍使用服务端 `X-API-Key`。不得把服务端密钥写入 `VITE_*` 或前端构建产物。

后台登录接口为 `POST /auth/session`（JSON：`{"password":"..."}`），`GET /auth/session` 查询状态，`DELETE /auth/session` 退出。会话默认 8 小时、最多 24 小时，服务进程重启后失效；当前会话保存在单进程内存中，多 worker/多实例部署前需改用共享会话存储。登录每个客户端 IP 最多 5 次/5 分钟；会话写请求要求 `Origin` 是配置的允许来源或通过可信反代校验的同源地址。

后台浏览器会话请求使用 `credentials: "include"`。公网设置精确的 `AGENT_CORS_ORIGINS=https://<前端域名>`，使用 HTTPS，并保持 `AGENT_BROWSER_COOKIE_SECURE=1`、`AGENT_BROWSER_COOKIE_SAMESITE=lax`。启用后台浏览器登录后会关闭 Quick Tunnel 通配正则；跨域登录 Origin 必须精确匹配白名单，同源登录则校验当前请求主机与可信反代协议。本地 HTTP 开发可设置 `AGENT_BROWSER_COOKIE_SECURE=0`，并让前后端使用同一主机名，例如前端 `localhost:5173`、API `localhost:8787`；不要混用 `localhost` 和 `127.0.0.1`。登录密码与 API Key 仅写在后端 `.env`，不要放入 `VITE_*` 或提交到 GitHub。

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

独立 Agent 仅配置 DeepSeek Chat Completions 接口，默认地址为 `https://api.deepseek.com/v1`，模型为 `deepseek-chat`。复制 `.env.example` 为 `.env`，只在服务端填写 `AGENT_LLM_API_KEY`。`.env` 已加入 Git 忽略规则，不要把密钥发到聊天、写入 `VITE_*` 变量或提交到仓库。启动/重启脚本会自动读取该文件，并启动 8788/8789 两个 Agent。

当前实现请求 JSON Object，再由 Agent 本地校验返回结构；模型调用失败或输出不符合 Agent 契约时会标记并降级到本地规则。配置更新后运行 `.\restart.ps1`，并确认两个 Agent 的健康状态及战局来源标签。具体环境变量见 `.env.example`。

默认端口分别为 8788 和 8789，可用 `-AttackerPort`、`-DefenderPort` 修改；端口必须不同。公网部署前还需要分别部署并配置稳定 HTTPS 地址及平台要求的真实身份/认证材料，不能直接把上述 `127.0.0.1` 地址交给平台或队友。

事件记录默认限制为 32 KB；超限样本会截短并添加 `dataTruncated` 标记，可通过 `AGENT_EVENT_DATA_MAX_BYTES` 调整，最小值为 1 KB。

### 外部安全案例库

外部案例库是只读的来源参考库，导入 CISA 官方 KEV JSON 和 NVD CVE API 2.0 数据，并保留快照版本、抓取时间、来源 URL
和内容 SHA-256。查询按 CVE ID 去重，同一 CVE 优先展示 CISA KEV 记录。查询接口为 `GET /external-cases`，支持 `q`、`vendor`、`product`、`limit` 和 `offset`；
返回结果会明确标注 `verified_primary`、`external_fact` 和来源元数据。外部案例不自动写入战局，也不代表
项目已经观察到真实攻击事件。完整字段和校验命令见 [`docs/EXTERNAL_CASE_LIBRARY.md`](../docs/EXTERNAL_CASE_LIBRARY.md)。

NVD 导入需要明确指定带时区的发布时间起止时间，单次窗口最长 120 天；默认按未认证 API 的请求频率分页，设置 `NVD_API_KEY` 可使用更高的官方速率限制。NVD rejected 记录会被跳过。

外部目录版本差异可用 `uv run python scripts/compare_external_cases.py` 查看。提交前运行
`uv run python scripts/check_sensitive_files.py --staged`；CI 会阻止证书、私钥、凭据、数据库、JSONL、私有 wheel 和本地配置进入仓库。

设置 `AGENT_PROTECT_READS=1` 后，后台事件、回放、战报、排行榜、审计和 SSE 等非公开页面读取接口需要服务端 API Key 或有效浏览器会话。面向公众的 Vite 前端所需 API 不受该开关影响。本地默认关闭。不要将服务端密钥直接写进公开前端代码。

SQLite 会记录 `schema_migrations` 基线版本并以幂等 DDL 自动补齐当前表和索引。Alembic 版本迁移位于 `backend/alembic/`，执行 `uv run alembic upgrade head`。PostgreSQL 使用 psycopg 连接池，MySQL 使用 SQLAlchemy/PyMySQL 连接池；最大连接数可通过 `AGENT_DB_POOL_MAX_SIZE` 调整。MySQL 连接配置和目标实例验收步骤见 `docs/DEPLOYMENT.md`。

终态战局的内部运行质量评分会写入 `battle_scores` 快照表（评分规则版本、完整 JSON 和计算时间），评分接口优先读取快照；旧战局没有快照时仍按事件实时计算。部署数据库迁移后再启用该表，禁止手工删除评分记录。

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
