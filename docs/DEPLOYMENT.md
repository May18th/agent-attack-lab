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

在 Cloudflare 控制台创建命名隧道并复制 Token，然后在 PowerShell 中设置：

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
