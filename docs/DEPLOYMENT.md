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

当前项目已创建命名 Tunnel `agent-attack-lab`，固定 API 域名为：

```text
https://api.kcwx.online
```

`kcwx.online` 已完成 Cloudflare NS 委派，当前可直接使用：

```text
mimi.ns.cloudflare.com
shane.ns.cloudflare.com
```

本机命名 Tunnel 配置位于用户目录下的 `.cloudflared/agent-attack-lab.yml`，不会提交到 Git。启动脚本会优先使用该命名 Tunnel，找不到配置时才回退到临时 Quick Tunnel。

如果在另一台电脑重新部署，创建命名隧道并复制 Token，然后在 PowerShell 中设置：

```powershell
$env:CLOUDFLARE_TUNNEL_TOKEN = "不要把真实 Token 提交到 Git"
cd "D:\梧桐\backend"
.\start-tunnel.ps1
```

命名隧道的域名由 Cloudflare 控制台绑定，重启后保持不变。Token 只放在本机环境变量或部署平台密钥中。

## PostgreSQL

SQLite 是默认开发数据库。生产环境设置 PostgreSQL 连接串：

```powershell
$env:AGENT_BATTLE_DATABASE_URL = "postgresql://用户名:密码@主机:5432/数据库名"
cd "D:\梧桐\backend"
uv sync
.\restart.ps1
```

数据库连接串不提交到仓库。未设置 `AGENT_BATTLE_DATABASE_URL` 时继续使用 `.data/battles.sqlite3`。

## 限流和备份

写入接口默认按客户端地址限制为每分钟 60 次，可用环境变量调整：

```powershell
$env:AGENT_RATE_LIMIT_PER_MINUTE = "60"
```

SQLite 开发库可以使用脚本备份。恢复前先停止后端，恢复脚本默认拒绝覆盖已有文件：

```powershell
cd "D:\梧桐\backend"
.\backup.ps1
.\restore.ps1 -BackupPath ".data\backups\你的备份文件.sqlite3" -Force
```

上述脚本仅适用于 SQLite。使用 PostgreSQL 时请使用 `pg_dump`/`pg_restore`，不要把 PostgreSQL 连接串当作 SQLite 路径传给脚本。
