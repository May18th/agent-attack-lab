# 前后端待办分工与状态

更新时间：2026-10-10

## 前端事项

| 状态 | 事项 |
|---|---|
| 已完成 | React + TypeScript 工程、API 客户端和表单流程 |
| 已完成 | `low`、`mid`、`high` 三种难度创建战局 |
| 已完成 | 攻击样本、风险、发现和修复建议展示 |
| 已完成 | 历史战局列表、详情、分页、搜索和刷新恢复 |
| 已完成 | 加载、空结果、422、404、5xx、网络错误提示 |
| 已完成 | `agentSource` 三态及未知来源展示 |
| 已完成 | Workers Static Assets 配置和 `npm run deploy` |
| 已完成 | 前端测试 16/16、lint 和生产构建 |
| 待 Cloudflare 账号操作 | 确认使用 Pages 或 Workers，并完成正式发布 |
| 待 Cloudflare 账号操作 | 配置正式前端域名和 HTTPS，记录生产地址 |
| 待联调 | 使用正式 API 地址构建并验收浏览器主流程 |

前端项目目录：`frontend/frontend-ui`

## 后端事项

| 状态 | 事项 |
|---|---|
| 已完成 | AIP/ACP 本地链路和 SDK 兼容修复 |
| 已完成 | CORS、错误处理、限流和浏览器会话接口 |
| 待 Cloudflare 账号操作 | 在域名所属账号创建后端 Cloudflare Tunnel |
| 待 Cloudflare 账号操作 | 配置 `api.yuanyiagentzhandui.cn` 转发到 `http://127.0.0.1:8787` |
| 待验收 | 公网验证 `/health`、`/dashboard/summary` 和 `POST /battles` |
| 待验收 | 确认攻击/防守 Agent 稳定的 `/rpc` 地址 |
| 待平台操作 | 完成 Leader AIC、证书和双向 mTLS |
| 待平台操作 | 获取官方 Wutong `release-manifest.json` 并通过发行预检 |

不要把 API Key、Tunnel Token、EAB、证书或私钥提交到仓库。

## 共同联调验收

1. 前端正式 HTTPS 页面可以打开。
2. 浏览器 CORS 预检成功，并按要求携带会话凭据。
3. `low`、`mid`、`high` 均能创建并完成战局。
4. 页面能显示攻击样本、`caught`、`risks` 和 `fixed`。
5. 历史列表、详情和刷新恢复正常。
6. 记录前端地址、API 地址、Git 提交版本和失败请求的 `X-Request-ID`。

## 当前提交

- 前端部署配置提交：`93c6941`
- GitHub Actions：后端测试和前端构建检查均通过。
