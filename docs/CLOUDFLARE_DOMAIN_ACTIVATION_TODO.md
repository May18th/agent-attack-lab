# Cloudflare 域名上线待办

更新时间：2026-10-10

目标域名：`yuanyiagentzhandui.cn`

> 以下操作必须在域名所有者/队友已授权的 Cloudflare 账号中完成。登录密码、API Token、Tunnel Token、证书和私钥不得写入仓库、聊天或前端环境变量。

## 1. 激活域名 Zone

- [ ] 登录域名所有者的 Cloudflare 账号。
- [ ] 打开站点 `yuanyiagentzhandui.cn`。
- [ ] 点击 **Check nameservers now / 立即检查名称服务器**。
- [ ] 等待状态从 Pending 变为 **Active**。
- [ ] 确认 Cloudflare 显示的名称服务器已经在域名注册商处生效。

验收证据：Zone 状态为 `Active`，记录检查时间和 Cloudflare 账号/Zone（不要记录密码或 Token）。

## 2. 配置 DNS

- [ ] 前端根域名和 `www` 按选定的 Pages/Workers 托管方式绑定。
- [ ] 后端使用 `api.yuanyiagentzhandui.cn`，不要与前端记录指向同一个源站。
- [ ] 删除同名冲突的旧 A、AAAA 或 CNAME 记录前，先确认它们不属于其他项目。
- [ ] Tunnel 和 DNS 记录必须属于同一个 Cloudflare 账号。

建议目标：

```text
https://yuanyiagentzhandui.cn       -> 前端托管
https://www.yuanyiagentzhandui.cn   -> 前端托管或重定向
https://api.yuanyiagentzhandui.cn   -> 后端 Tunnel
```

## 3. 配置后端 Tunnel

- [ ] 进入 **Zero Trust → Networks → Tunnels**。
- [ ] 创建或选择后端 Cloudflared Tunnel。
- [ ] 添加 Public Hostname：`api.yuanyiagentzhandui.cn`。
- [ ] Service 设置为 `http://127.0.0.1:8787`。
- [ ] 在后端电脑安装连接器并重启 `cloudflared` 服务。
- [ ] 不把连接器 Token 提交到 GitHub；Token 只在后端主机本地输入。

后端负责人验证：

```powershell
Invoke-RestMethod "https://api.yuanyiagentzhandui.cn/health"
Invoke-RestMethod "https://api.yuanyiagentzhandui.cn/dashboard/summary"
```

完成标准：两个接口返回 HTTP 200 和本项目 JSON，而不是 Cloudflare 1033/502/530、HTML 或其他服务响应。

## 4. 配置 SSL/TLS

- [ ] 在 **SSL/TLS → Overview** 选择与后端源站证书匹配的模式；有 HTTPS 源站时优先 `Full (strict)`。
- [ ] 确认前端域名和 `api` 子域名证书状态为 Active/有效。
- [ ] 开启 HTTPS 重定向和适用的自动 HTTPS 重写。
- [ ] 用无代理方式检查前端和 API 的 HTTPS 响应。

```powershell
curl.exe --noproxy "*" -I https://yuanyiagentzhandui.cn
curl.exe --noproxy "*" -I https://www.yuanyiagentzhandui.cn
curl.exe --noproxy "*" -I https://api.yuanyiagentzhandui.cn/health
```

## 5. 前后端联调验收

- [ ] 前端构建变量为 `VITE_AGENT_API=https://api.yuanyiagentzhandui.cn`。
- [ ] 后端 `AGENT_CORS_ORIGINS` 精确包含最终前端 Origin。
- [ ] 浏览器可打开正式前端页面且无白屏。
- [ ] `low`、`mid`、`high` 三种难度都能创建战局。
- [ ] 历史列表、详情和刷新恢复正常。
- [ ] 记录 Git 提交版本、前端地址、API 地址和失败请求的 `X-Request-ID`。

## 回执模板

```text
Cloudflare 域名上线回执：

1. Zone 状态：Pending / Active
2. 前端地址：
3. API 地址：
4. Tunnel 名称及状态：
5. /health：
6. /dashboard/summary：
7. SSL/TLS 模式及证书状态：
8. CORS 预检：
9. low/mid/high 战局：
10. Git 提交版本：
11. 未解决问题及 X-Request-ID：
```
