# 前后端联调交接

更新时间：2026-10-08

## 当前状态

- 队友截图回执：前端本地测试、lint、build 及同机 5175 → 8787 联调通过；low/mid/high 创建战局成功。
- 公网尚未验收。队友管理的新域名为 `yuanyiagentzhandui.cn`，需完成 Cloudflare Zone、DNS、前端 HTTPS、后端 Tunnel、CORS 和鉴权。
- 计划 API：`https://api.yuanyiagentzhandui.cn`。验收完成前不可配置为已用地址。
- `kcwx.online` 是用户原有域名，已从本项目退役，不得作为 API、备用地址或 Tunnel 配置。

## 后端浏览器会话接口

后端提供单密码登录会话，避免把 `AGENT_API_KEY` 编译到 Vite：

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/auth/session` | JSON `{"password":"..."}` 登录，服务端设置 HttpOnly Cookie |
| `GET` | `/auth/session` | 返回 `enabled` 与 `authenticated` |
| `DELETE` | `/auth/session` | 退出并撤销当前会话 |

前端需给登录请求和后续 API 请求设置 `credentials: "include"`，SSE `EventSource` 设置 `withCredentials: true`。前端不能接收或保存 `AGENT_API_KEY`。`/agent/*`、`/rpc`、`/metrics` 不接受浏览器会话，仍由服务端 API Key 保护。

会话默认 8 小时，最长 24 小时；服务重启会使会话失效。当前会话存于单进程内存，不适用于多 worker/多实例部署。登录限流为每客户端 IP 5 次/5 分钟；会话写请求要求 `Origin` 在后端允许来源中。

## 后端部署配置

后端负责人在服务器本地 `.env` 设置，不要把实际密码发到聊天或提交 GitHub：

```env
AGENT_API_KEY=<服务端生成的高强度随机密钥>
AGENT_BROWSER_PASSWORD=<浏览器登录密码>
AGENT_PROTECT_READS=1
AGENT_BROWSER_COOKIE_SECURE=1
AGENT_BROWSER_COOKIE_SAMESITE=lax
AGENT_CORS_ORIGINS=https://yuanyiagentzhandui.cn
```

Cookie 使用 HTTPS。若前端最终使用 `www` 或其他 Origin，将确切 Origin 逗号分隔加入 `AGENT_CORS_ORIGINS`，不要放宽为任意来源。启用浏览器登录时，服务端要求同时配置 `AGENT_API_KEY` 并关闭 Quick Tunnel 通配 CORS。后端重启后测试登录 Cookie、浏览器 API 和读保护。

本地 HTTP 联调若启用登录，前端和 API 使用同一主机名，例如 `localhost:5173` 与 `localhost:8787`，并仅在本机将 `AGENT_BROWSER_COOKIE_SECURE=0`。不要混用 `localhost` 和 `127.0.0.1`。

## 公网验收

队友确认域名托管完成并开放所需 Zone 权限后，后端负责人配置 `api.yuanyiagentzhandui.cn -> http://127.0.0.1:8787`。验收顺序：

1. HTTPS 页面与 `GET /health` 均可访问。
2. 未登录访问战局 REST 读写接口为 `401`；正确登录后 Cookie 访问成功。
3. 非允许 Origin 的会话写请求被拒绝；浏览器预检返回精确的 CORS Origin 和 `Access-Control-Allow-Credentials: true`。
4. `low`、`mid`、`high` 战局创建、历史列表、详情和 SSE 均通过。
5. `/metrics`、`/rpc` 与 `/agent/*` 未被浏览器会话开放；记录提交版本及失败请求 `X-Request-ID`。
