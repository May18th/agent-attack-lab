# 未完成待办交接清单

更新时间：2026-10-09

本文记录当前尚未完成的部署与联调事项，并按负责人划分。前端代码的测试、Lint 和生产构建已经通过；以下事项主要涉及 Cloudflare 托管、后端公网入口和最终联调。

## 前端队友

- [ ] **完成正式网站托管与 HTTPS**
  - 在 Cloudflare Pages（或已正确配置的 Workers Static Assets）部署前端。
  - 绑定 `yuanyiagentzhandui.cn`，以及团队约定的 `www` 域名（如需要）。
  - 验收标准：正式域名可以通过 HTTPS 打开前端页面。

- [ ] **修复 Cloudflare 构建失败**
  - 先确认采用 Pages 还是 Workers Static Assets，不要把 Vite 静态站点直接按普通 Worker 部署。
  - 前端目录：`frontend/frontend-ui`
  - 构建命令：`npm ci && npm run build`
  - 输出目录：`dist`
  - 验收标准：Cloudflare 构建成功并提供部署或预览地址。

- [ ] **配置生产 API 地址**
  - 在部署平台生产环境变量中设置：

    ```env
    VITE_AGENT_API=https://api.yuanyiagentzhandui.cn
    ```

  - 不要提交 `.env.local`、API Key、Tunnel Token 或私钥。

- [ ] **提交前端部署回执**
  - 记录托管平台、正式 HTTPS 地址、构建设置、部署提交版本和已知问题。

## 后端队友

- [ ] **修复公网 API Tunnel**
  - 当前 `https://api.yuanyiagentzhandui.cn` 的 `/health`、`/dashboard/summary` 和 `/battles` 曾返回或超时于 Cloudflare `502`。
  - 检查 Tunnel Connector 是否在线，并确认转发到后端 `http://127.0.0.1:8787`。
  - 验收标准：上述接口通过 HTTPS 返回本项目 JSON，而不是 `502`、HTML 或其他服务响应。

- [ ] **配置生产 CORS 与鉴权**
  - 将最终前端 Origin 精确加入 CORS 白名单。
  - 验证 `/auth/session` 登录、读取和退出流程，以及需要登录接口的 Cookie 会话。
  - 不要把后端 API Key 放入任何 `VITE_*` 前端变量。

- [ ] **提交 API 验收结果**
  - 提供 `/health`、`/dashboard/summary`、创建战局和查询战局的 HTTPS 验收结果。
  - 失败时记录状态码、时间、响应头和 `X-Request-ID`。

## 双方联调

- [ ] 正式前端 HTTPS 页面可访问。
- [ ] 浏览器可正常读取 `/health` 和 `/dashboard/summary`，无 CORS 或 401 异常。
- [ ] 分别完成 `low`、`mid`、`high` 战局创建。
- [ ] 页面正确显示 `attackerOut.samples`、`defenderOut.caught`、`risks` 和 `fixed`。
- [ ] 历史列表、战局详情和刷新恢复功能正常。
- [ ] 将最终联调回执、Git 提交版本和未解决问题回填到 GitHub。

## 当前已完成

- 前端 FE-01 至 FE-09、FE-11 至 FE-16 已完成。
- 前端测试：10/10 通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- 本地开发页面可运行；公网验收仍依赖后端 API Tunnel 和正式前端托管恢复。
