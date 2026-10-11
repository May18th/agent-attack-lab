# 前后端联调交接

更新时间：2026-10-08

## 当前状态

- 队友截图回执：前端本地测试、lint、build 及同机 5175 → 8787 联调通过；low/mid/high 创建战局成功。
- 公网尚未验收。队友管理的新域名为 `yuanyiagentzhandui.cn`，需完成 Cloudflare Zone、DNS、前端 HTTPS、后端 Tunnel、CORS 和鉴权。
- 计划 API：`https://api.yuanyiagentzhandui.cn`。验收完成前不可配置为已用地址。
- `kcwx.online` 是用户原有域名，已从本项目退役，不得作为 API、备用地址或 Tunnel 配置。

## 公开前端与后台认证边界

正式前端面向公众，不显示密码页，也不要求 Cloudflare Access 登录。公开业务 API 为 `/health`、`/dashboard/summary`、`/external-cases`、`/battles`（GET/POST）和 `/battles/{battle_id}`（GET）。公开创建战局默认每客户端 IP 每分钟限 10 次；当前是单进程限流，多实例部署还要在入口代理增加限流。

后端管理页 `/dashboard`、战局重试/删除、审计/报告/事件回放/SSE，以及 `/agent/*`、`/rpc` 和 `/metrics` 继续受后端认证保护。Cloudflare Access 可用于这些管理入口；不得对前端/API 的公开业务路由套用强制组织登录策略。后端配置以下变量时，会对受保护路由验证 Cloudflare 注入的 `Cf-Access-Jwt-Assertion`：

```env
CF_ACCESS_TEAM_DOMAIN=https://<team-name>.cloudflareaccess.com
CF_ACCESS_AUDIENCE=<Access application AUD tag>
```

两个变量必须同时配置。正式部署仍配置 `AGENT_API_KEY`，用于 `/agent/*`、`/rpc`、`/metrics` 和后台运维接口；
不要把任何 Access token、API Token 或 API Key 写入 `VITE_*` 或仓库。

## 兼容的后台浏览器会话接口

后端提供单密码登录会话，避免把 `AGENT_API_KEY` 编译到 Vite：

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/auth/session` | JSON `{"password":"..."}` 登录，服务端设置 HttpOnly Cookie |
| `GET` | `/auth/session` | 返回 `enabled` 与 `authenticated` |
| `DELETE` | `/auth/session` | 退出并撤销当前会话 |

公开 React 前端不调用该登录接口。仅后台页面/运维客户端在使用密码会话时设置 `credentials: "include"`。普通公开业务请求不能据此获得内部操作权限；`/agent/*`、`/rpc`、`/metrics` 仍由服务端 API Key 保护。

会话默认 8 小时，最长 24 小时；服务重启会使会话失效。当前会话存于单进程内存，不适用于多 worker/多实例部署。登录限流为每客户端 IP 5 次/5 分钟；会话写请求要求 `Origin` 在后端允许来源中。

## 后端部署配置

若需保护后台页面且暂时不能使用 Cloudflare Access，后端负责人可在服务器本地 `.env` 启用兼容密码会话；该密码只用于后台，
不要把实际密码发到聊天或提交 GitHub：

```env
AGENT_API_KEY=<服务端生成的高强度随机密钥>
AGENT_BROWSER_PASSWORD=<浏览器登录密码>
AGENT_PROTECT_READS=1
AGENT_PUBLIC_BATTLE_LIMIT_PER_MINUTE=10
AGENT_BROWSER_COOKIE_SECURE=1
AGENT_BROWSER_COOKIE_SAMESITE=lax
AGENT_CORS_ORIGINS=https://yuanyiagentzhandui.cn
```

Cookie 使用 HTTPS。若前端最终使用 `www` 或其他 Origin，将确切 Origin 逗号分隔加入 `AGENT_CORS_ORIGINS`，不要放宽为任意来源。启用浏览器登录时，服务端要求同时配置 `AGENT_API_KEY` 并关闭 Quick Tunnel 通配 CORS。后端重启后测试登录 Cookie、浏览器 API 和读保护。

本地 HTTP 联调若启用登录，前端和 API 使用同一主机名，例如 `localhost:5173` 与 `localhost:8787`，并仅在本机将 `AGENT_BROWSER_COOKIE_SECURE=0`。不要混用 `localhost` 和 `127.0.0.1`。

## 公网验收

队友确认域名托管完成并开放所需 Zone 权限后，后端负责人配置 `api.yuanyiagentzhandui.cn -> http://127.0.0.1:8787`。验收顺序：

1. HTTPS 页面与 `GET /health` 均可访问，无需组织认证。
2. 无登录状态可读取统计、案例、战局列表/详情并创建战局；超过公开创建限额返回 `429`。
3. 后端管理页、重试/删除、报告/事件回放/SSE 和审计拒绝匿名访问；配置的后台会话或 Access 身份可访问。
4. `/metrics`、`/rpc` 与 `/agent/*` 仍要求服务端 API Key；前端构建产物不含 API Key。
5. `low`、`mid`、`high` 战局创建和历史查看通过；记录提交版本及失败请求 `X-Request-ID`。
