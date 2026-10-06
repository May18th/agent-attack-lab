
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
- `GET /battles/{battle_id}/events`：读取持久化事件时间线。
- `GET /battles/{battle_id}/replay`：按事件顺序获取回放数据。
- `GET /battles/{battle_id}/events/stream?follow=true`：SSE 事件流。
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

部署到公网时可设置 `AGENT_API_KEY`。设置后，`POST /battles`、`POST /agent/*` 和 `POST /rpc` 必须携带 `X-API-Key` 请求头；本地未设置时保持免密开发模式。

异步实时战局：

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/battles?background=true' -ContentType 'application/json' -Body '{"difficulty":"high","topic":"提示注入"}'
```

该模式先返回 `pending/running` 战局，随后通过事件接口、SSE 或 WebSocket 更新到 `completed`。稳定公网隧道和 PostgreSQL 配置见 `docs/DEPLOYMENT.md`。

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
