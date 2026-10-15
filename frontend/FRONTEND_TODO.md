# 前端当前待办

更新时间：2026-10-15

旧版 FE-01 至 FE-16、临时 Tunnel、Pages 域名绑定和早期公网故障步骤均已完成或
失效，已从本文删除。当前状态以 [`../docs/CURRENT_STATUS.md`](../docs/CURRENT_STATUS.md)
为准。

## 待完成

- [ ] **处理重复的 Workers Builds 集成**
  - 账户 `434bfd...` 下的重复构建仍失败，由该 Cloudflare 账户维护者确认归属。
  - 若保留，根目录应为 `frontend/frontend-ui`，并在该目录执行构建和 Preview 命令。
  - 若已弃用，断开重复集成；不要修改已经正常工作的 Workers Preview 配置。
  - 本机无该账户控制台权限时，需账户维护者在 Cloudflare 后台操作。

## 已完成

- [x] React + TypeScript 前端、统一 API 客户端和类型。
- [x] 主题及 `low`、`mid`、`high` 难度输入。
- [x] 战局创建、历史列表、详情、分页、搜索和刷新恢复。
- [x] 攻击样本、规则命中、风险、修复建议和来源标记展示。
- [x] 加载、空结果、`422`、`404`、`5xx` 和网络错误处理。
- [x] 响应式布局、前端测试、Lint 和生产构建。
- [x] 正式根域名、`www` 和正式 API HTTPS 可访问。
- [x] Preview 使用独立 HTTPS API 和独立数据库，构建时拒绝正式 API、localhost
  和缺失配置。
- [x] PR #4–#8 已合并；Preview Worker bundle 指向 `preview-api`，生产 bundle 指向
  正式 API；Preview API 上 low/mid/high 创建 201 并完成删除清理。
- [x] 详情页内部评分展示、失败重试、删除已结束战局、pending/running 轮询。
- [x] 本地评分请求增加战局选择态校验，避免切换战局后迟到的旧响应覆盖当前内容；Vitest 23 项、构建环境测试 4 项、Lint、Build 通过。
- [ ] 上述前端功能尚未部署；真实浏览器交互和生产发布尚未验收。

## 配置边界

- 正式前端 API：`https://api.yuanyiagentzhandui.cn`
- Preview API：`https://preview-api.yuanyiagentzhandui.cn`
- 公开前端不保存 API Key，也不要求浏览器密码；管理路由继续由后端鉴权。
- 不提交 `.env.local`、API Key、Tunnel Token、证书、私钥、数据库或测试数据。
