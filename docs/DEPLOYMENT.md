# 部署说明

## 本地服务

后端默认监听 `http://127.0.0.1:8787`：

```powershell
cd "D:\梧桐\backend"
uv sync
.\restart.ps1
```

## 临时公网地址

```powershell
cd "D:\梧桐\backend"
.\start-tunnel.ps1
```

Quick Tunnel 每次启动都会生成新地址，关闭进程后地址失效，只适合联调。

## 稳定公网地址

本项目的新公网地址尚未完成配置和验收。队友提供的域名拟分配为前端 `https://yuanyiagentzhandui.cn`、后端 API `https://api.yuanyiagentzhandui.cn`；这只是待办目标，不代表当前可访问。域名 Zone 由队友管理，取得其 Cloudflare Zone 权限后，才可在同一账户配置 DNS 和后端 Tunnel。具体分工见 `frontend/FRONTEND_TODO.md`。

在新域名下的 Tunnel 与 API 完成公网验收前，跨电脑远程联调暂停。不要将本项目接到负责其他项目的旧域名/Tunnel，也不要修改或删除那些旧资源。Tunnel Token 只能通过安全渠道配置在后端主机或部署密钥中，不得提交到 Git 或聊天。

## MySQL / PostgreSQL

SQLite 是默认开发数据库。生产环境设置 PostgreSQL 连接串：

```powershell
$env:AGENT_BATTLE_DATABASE_URL = "postgresql://用户名:密码@主机:5432/数据库名"
cd "D:\梧桐\backend"
uv sync
.\restart.ps1
```

也支持 MySQL 8+，连接池使用 PyMySQL/SQLAlchemy。先在 MySQL 创建专用数据库和最小权限用户，再配置连接串：

```powershell
$env:AGENT_BATTLE_DATABASE_URL = "mysql://用户名:URL编码后的密码@主机:3306/数据库名?charset=utf8mb4"
cd "D:\梧桐\backend"
uv sync
uv run alembic upgrade head
.\restart.ps1
```

密码含 `@`、`:`、`/`、`#` 等 URL 保留字符时必须进行百分号编码。MySQL 当前支持自动建表、索引、分页查询和重复记录更新；正式启用前仍需在目标 MySQL 实例执行迁移及读写验收。

数据库连接串不提交到仓库。未设置 `AGENT_BATTLE_DATABASE_URL` 时继续使用 `.data/battles.sqlite3`。

## 限流和备份

写入接口默认按客户端地址限制为每分钟 60 次，可用环境变量调整：

```powershell
$env:AGENT_RATE_LIMIT_PER_MINUTE = "60"
```

如果设置了 `AGENT_API_KEY`，内部指标接口 `GET /metrics` 也需要携带 `X-API-Key`。SQLite 开发库会自动启用 WAL、忙等待和常用筛选索引；生产多实例部署仍建议使用 PostgreSQL。

SQLite 开发库可以使用脚本备份。恢复前先停止后端，恢复脚本默认拒绝覆盖已有文件：

```powershell
cd "D:\梧桐\backend"
.\backup.ps1
.\restore.ps1 -BackupPath ".data\backups\你的备份文件.sqlite3" -Force
```

上述脚本仅适用于 SQLite。使用 PostgreSQL 时请使用 `pg_dump`/`pg_restore`，不要把 PostgreSQL 连接串当作 SQLite 路径传给脚本。

## 读接口访问保护和事件限制

公网部署可设置以下环境变量：

```powershell
$env:AGENT_API_KEY = "请替换为自行生成的高强度随机密钥"
$env:AGENT_PROTECT_READS = "1"
$env:AGENT_EVENT_DATA_MAX_BYTES = "32768"
```

将 `AGENT_API_KEY` 替换为自行生成的高强度随机密钥，不要使用示例文字。启用 `AGENT_PROTECT_READS=1` 后，战局列表/详情、事件、回放、战报、排行榜和 SSE 事件流都要求 `X-API-Key`；写入接口和 `/metrics` 也由 `AGENT_API_KEY` 保护。默认读保护关闭以兼容当前前端联调。不要把服务端 API Key 编译进公开前端或提交到 GitHub；公开部署应使用登录会话或由后端提供受控代理。

当前提供单密码浏览器会话：在后端同时配置 `AGENT_BROWSER_PASSWORD` 和 `AGENT_API_KEY`，浏览器调用 `POST /auth/session` 登录并接收 `HttpOnly` Cookie，通过 `GET /auth/session` 查询、`DELETE /auth/session` 退出。前端请求需设置 `credentials: "include"`；部署时精确设置 `AGENT_CORS_ORIGINS`，生产必须使用 `AGENT_BROWSER_COOKIE_SECURE=1`。启用后 Quick Tunnel 通配来源关闭，只接受精确 CORS Origin。该会话不会授权 `/agent/*`、`/rpc`、`/metrics`，这些接口继续使用服务端 API Key。会话当前只保存在单进程内存中，服务重启会要求重新登录，不可直接用于多 worker 或多实例部署。

事件单条数据默认不超过 32 KB。过长攻击样本会截短，返回数据包含 `dataTruncated` 和 `originalBytes`，避免数据库被超大输入拖大。

## 异步战局恢复

`POST /battles?background=true` 会持久化 `pending` 状态和事件。进程启动后会重新调度仍为 `pending` 或 `running` 的战局。明确失败的战局可以通过 `POST /battles/{battle_id}/retry` 再次执行。该机制可应对单机服务重启，不替代跨多实例部署所需的任务队列和分布式锁。

SQLite 初始化会建立 `schema_migrations` 基线版本和所需索引。版本化迁移脚本位于 `backend/alembic/`，部署前在 backend 目录运行：

```powershell
uv run alembic upgrade head
```

PostgreSQL 使用 psycopg 连接池，MySQL 使用 SQLAlchemy/PyMySQL 连接池；默认最大 10 个连接，可通过 `AGENT_DB_POOL_MAX_SIZE` 调整。未提供可连接的生产数据库实例时，自动化测试只能验证驱动选择和 SQL 生成，不能替代真实数据库迁移/连接池联调。
