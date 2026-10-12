# 当前项目状态

更新时间：2026-10-11

本文只记录当前状态；历史执行证据见 [`TEAM_HANDOFF.md`](TEAM_HANDOFF.md) 与 Git 历史。

## 2026-10-12 验收复测（12:15-12:26 +08:00）

- 生产部署：VPS `/opt/agent-attack-lab` 当前提交 `a0d62429c82a2ad122829dc8104f25505c0a22c8`，与远端 `main` 一致。API、attacker、defender、preview 和 `cloudflared-agent-attack-lab` 用户服务均 `active` 且 `enabled`，user linger 为 `yes`。VPS 工作树另有 `backend/scripts/start-service.sh` 未提交修改，本轮未触碰。
- 公网只读：正式 API `/health`、`/dashboard/summary`、`/battles?limit=1`、`/external-cases?limit=1`、`/openapi.json` 均 HTTP 200；OpenAPI 包含 `DELETE /battles/{battle_id}`。正式站首页、`www`、隔离 Preview 首页和 Preview API `/health` 均 HTTP 200。正式前端 bundle 仅指向生产 API，Preview bundle 仅指向隔离 API；两者都未发现浏览器密码表单或 `/auth/session` 调用。
- CORS：正式前端 `https://www.yuanyiagentzhandui.cn` 到生产 API 的 POST 预检 HTTP 200；Preview Worker 到 `preview-api.yuanyiagentzhandui.cn` 的 POST 预检 HTTP 200，均返回匹配的 `Access-Control-Allow-Origin`，允许方法 `GET, POST, DELETE, OPTIONS`。
- 浏览器会话：未登录 `/auth/session` 为 `authenticated=false`；使用既有管理员凭据登录 HTTP 200，`Secure`、`HttpOnly`、`SameSite=Lax` Cookie 生效，登录后 `/dashboard` 返回管理页；独立复测会话注销 HTTP 200，状态恢复 `authenticated=false`。一次较早的受保护回放请求超时，未收到 X-Request-ID；对应临时 Cookie 未写盘或输出，服务端内存中的会话记录按 8 小时 TTL 自行过期（约 20:23 +08:00）。未重启服务以免清除其他用户会话。
- Partner mTLS/AIP：attack、defense `/health` 均 HTTP 200；无客户端证书 `/rpc` 均 HTTP 403。使用 Leader clientAuth 与 trust bundle 分别执行 AIP Start、Complete，两边均 HTTP 200，响应结构通过，task 最终 `completed`；攻击返回 1 个 low 样本，防守返回合法检测结构。两边均为 `local-rule`，未调用外部模型。Leader 主 `/rpc` 未执行真实 mTLS 调用。
- Discovery：梧桐 Discovery explicit 查询命中 Leader、attack、defense 三个当前 AIC；均 `active=true`，RPC URL 与正式域名一致，`transport=JSONRPC`、security 声明 `mtls`。本轮未更新 Registry/Discovery。
- Cloudflare：当前账号 Tunnel `yuanyi-agent-attack-lab-backend` 为 `healthy`，远程配置版本 4；api/attack/defense/preview-api 分别映射到 VPS `127.0.0.1:8787/8788/8789/8790`。公网 DNS 查询成功；本账号 Zone 列表未返回 `yuanyiagentzhandui.cn`，因此没有读取或修改 Zone DNS 记录。
- 隔离 Preview 写验收：空白 topic HTTP 422；low/mid/high 均创建 HTTP 201 且状态 `completed`，读取事件分别为 6/7/8 条；删除均 HTTP 204，删除后查询均 HTTP 404。请求 ID：空主题 `req-d6b1cdc6-8ee6-4916-ae80-d1e876e6e232`；low create/delete `req-2fadfddc-eb49-471a-866e-d0e0a68f6d3d` / `req-b620240f-d4e1-459d-ae85-0ca05e5a919c`；mid `req-5ed6e1e4-19d6-4714-85af-ee9af885c329` / `req-33e0a989-fce7-40b8-9550-7e62a187ec79`；high `req-4b54b0a8-e8dc-4460-90c5-9f3d8a9c1d35` / `req-416db6e5-cda7-4f82-a4d6-ab02c60c462a`。本机隔离存储契约测试 `4 passed`，覆盖运行中战局删除 HTTP 409 与删除事件清理。
- 边界：本轮没有对生产 `/battles` 执行创建或删除，避免写入/清理正式数据库；生产 low/mid/high 和真实浏览器页面交互未重新验收。Browser automation 未能启动（node repl Playwright 导入错误，前端未安装 Playwright）；HTTP/静态 bundle 检查不替代页面交互验收。Leader 生产 `/rpc` 与 Discovery 到生产战局的完整链路尚未实测。

## PR #3 Preview 更新（2026-10-12）

- Cloudflare Workers Builds trigger 仅匹配 `codex/deployment-status-sync`；`root_directory` 已改为 `/frontend/frontend-ui`，`build_command` 为 `npm run build`，保留 `npx wrangler preview`。未改生产部署命令、DNS 或其他分支。
- 提交 `9b34aacebc2f31aff3783ce2a9245cf56208da54` 的 Preview 构建成功，GitHub PR #3 的 Workers Builds 检查已通过。Preview URL：`https://codex-deployment-status-sync-agent-attack-lab.3498414260.workers.dev`，公网 GET 返回 200。
- 后续交接文档提交 `43e2f50d25605df96af10c6f67fc709be1f48ca1` 的自动 Preview build `fa2e3b8f-b976-49fa-80be-c8f3295270b9` 也成功，PR #3 后端、前端、Pages、Workers Builds 四项检查均通过。
- Preview URL 目前公开可访问。该构建没有设置 `VITE_AGENT_API`；前端默认 API 地址是 `http://127.0.0.1:8787`，即访问者自己的本机地址。虽然生产 API `/health` 当前返回 200，Preview 未连接生产 API，避免公开预览的写请求进入生产数据。端到端前后端联调需另设隔离 API 环境。
- 本地已增加 `npm run build:preview` 和 `frontend/frontend-ui/preview.env.example`；该构建强制使用独立 HTTPS API，并拒绝正式 API、localhost 和缺失配置。公开 Preview 若未配置 API，运行时会阻止请求，不再回退到访问者本机。

## 代码与发布

- PR #2 已于 2026-10-11 合并，合并提交 `ae959fb`，PR head 为 `47d5916`；后端、前端、Cloudflare Pages、Workers Builds 四项检查均成功。
- 当前本地协作分支 `codex/team-domain-handoff` 指向 `47d5916`，与对应 origin 分支同步。
- 前端正式域名 `https://yuanyiagentzhandui.cn` 与 `https://www.yuanyiagentzhandui.cn` 本轮只读请求均返回 200，首页引用 bundle `index-BzFvd3kT.js`。检查该 bundle 未发现密码表单、`/auth/session` 调用或管理员登录文案；公开前端不设浏览器密码。
- API 正式地址 `https://api.yuanyiagentzhandui.cn`：本轮 `/health`、`/dashboard/summary`、`/battles?limit=1`、`/external-cases?limit=1` 均返回 200；OpenAPI 包含 `DELETE /battles/{battle_id}`。
- 后台 `/dashboard` 和战局回放接口未登录均返回 401，后台鉴权仍保留。此次未对生产发送创建、更新或删除请求。
- Partner mTLS 本轮只读复测：attack/defense DNS 均解析至 `47.108.92.113`；VPS nginx、443 listener、API/攻击/防守服务均 active，nginx 配置检查通过。使用本机梧桐 trust bundle，无客户端证书访问两个 `/health` 均为 200、`/rpc` 均为 403；使用 Leader clientAuth 证书时两个 `/health` 为 200，`/rpc` TLS 握手成功（GET 返回 405，仅证明 HTTP 方法不适用，不等于完成 AIP 调用）。本轮未运行生产战局或 Discovery 查询。

## 生产边界与后续

- 生产代码部署记录指向 `47d5916`；本轮通过公网只读探测确认服务可响应及删除路由已公开，不代表已在生产执行全部写接口验收。
- 本轮未复验 Registry/Discovery 和 low/mid/high 全链路；这些结论仍沿用 `TEAM_HANDOFF.md` 中的历史验收记录。
- 不配置外部 LLM，Agent 继续规则兜底，等待负责人批准端点和凭据。
- 每小时巡检是否由外部调度器运行仍无法确认；不停止无关任务。
- 下一步由负责人安排安全环境的写接口验收：空白 topic=422、合法创建=201、已完成战局删除=204并清理事件、运行中战局删除=409；不拿生产数据做破坏性测试。

## 数据与安全

- CISA KEV 本机快照版本为 `2026.10.08`，1,739 条；先前只读对比官方源新增/删除/变更均为 0，SHA-256 为 `fb1621beec7db19d99c1f919dede3d4cc01ad88acd16f79f1592929c4826dfee`。
- 外部案例仅作注明来源的事实参考，不伪装成项目战局；战局审计只读。
- `battle-694dce7f` 曾在已检查的本机及 VPS 默认数据库中均未找到，不凭旧回执删除其他记录。
- 本机有未跟踪队友材料和发行 wheel，均保持原样、不纳入 Git。长期记忆、`.env`、Token、EAB、证书/私钥、数据库、日志、私有 wheel、JSONL 和机器本地配置禁止提交。
