# 当前项目状态

更新时间：2026-10-18

本文只记录当前状态；历史执行证据见 [`TEAM_HANDOFF.md`](TEAM_HANDOFF.md) 与 Git 历史。

## 最新状态（2026-10-18 18:31 +08:00）

- PR #15 已合并到 `main`，合并提交为 `10bb83e6703b244fcbdb5119c5c64f1e0f123cc8`。生产后端部署 Workflow `39119453067` 在 VPS self-hosted Runner `yuanyi-agent-attack-lab-vps`（用户 `deployer`）上成功完成，部署脚本输出 `DEPLOY OK`；Alembic 迁移执行完成，release worktree 与原生产工作树隔离。
- 部署脚本曾在服务重启后的首个 8787 探测出现一次瞬时连接失败，随后重试通过；该次失败不是最终部署失败。当前公网只读复验：`/health` HTTP 200，`/openapi.json` HTTP 200，`/dashboard/summary` HTTP 200。健康响应的 `requestId` 为 `req-2dfd86bc-49d9-4cd2-9978-9c1d8ee8894d`（2026-10-18 18:31 +08:00）。
- 当前公网 OpenAPI 包含 `DELETE /battles/{battle_id}`，但仍不包含 `/battles/{battle_id}/score` 与 `/internal-scores`。因此评分 v2 尚未被公网 API 证明已上线；不得把主线代码或内部 Preview 验收当作生产评分接口。
- 根因核查发现：release worktree 的 `start-service.sh` 原先未将 release 的 `src` 放到 `PYTHONPATH`，共享虚拟环境可能导入旧的已安装包，造成部署提交与运行代码不一致。PR #16 已将该路径修复部署到生产，但公网评分路由仍返回 404，说明还需确认 systemd 实际进程上下文。分支 `codex/verify-runtime-release` 已增加 `MainPID`、`/proc/<pid>/cwd` 和 `PYTHONPATH` 部署护栏；若运行进程未使用目标 release，部署会失败并自动恢复旧配置。
- 当前不接入外部 LLM/API；攻击、防守继续使用现有规则兜底，除非负责人另行决定。当前无开放 PR（本地修复分支尚未创建 PR）。
- 本机后端全量测试从 `backend` 目录执行为 `122 passed, 5 skipped`，仅有既有 Starlette/httpx 弃用警告；从仓库根目录运行会触发 Alembic 相对路径错误，不作为有效测试结果。

## 本地状态（2026-10-15，历史）

- 外部案例库本机已刷新 CISA KEV 官方目录：最新目录版本 `2026.10.14`，查询去重后 1,745 条；物理 SQLite 保留 3,484 条来源快照记录用于审计，校验 `valid=true`。NVD 导入代码、跨来源 CVE 去重和测试已补齐，但当前网络到 NVD API 两次超时，未导入 NVD 数据；生产案例库未同步。
- 本地新增 `battle_scores` 评分快照表（SQLite/PostgreSQL/MySQL 及 Alembic `20261015_0002`）：终态战局保存 `internal-agent-v2` 评分，评分接口优先读快照，历史战局无快照时实时回退；重试和删除会清理旧评分。尚未部署生产。
- 本机 `main` 与 `origin/main` 均为 `3d9109e`。PR #7 Pages Preview API 隔离修复及 PR #8 后端低风险性能优化均已进入主线；PR #8 合并提交为 `0b967d2`。
- 公网只读复核：API `/health=200`；外部案例接口 `available=true`、1,739 条、来源数 1，样本记录为 CISA `external_fact` 且 `synthetic=false`。
- 公网 `/openapi.json` 暂未包含 `/battles/{battle_id}/score` 与 `/internal-scores`；生产 API 与当前主线仍有版本差异。SSH `deployer@47.108.92.113:22` 本轮连接超时，无法查看 VPS HEAD、工作树、备份和回滚条件，因此没有部署或重启生产服务。
- 前端当前有 6 个本地改动文件，包含评分展示、失败重试、完成战局删除及异步评分状态保护。Vitest 23 项、构建环境 Node tests 4 项、Lint 和生产构建均通过；尚未部署，也未完成真实浏览器视觉/控制台/点击验收。
- NVD 官方 API 能返回 CVE 记录；但当前导入模型以来源快照保存，同一 CVE 跨来源或跨版本可能重复展示。尚未导入第二来源，也未把 NVD 数据当作本项目实战/观测事件。扩源前需先实现跨来源去重及可审计更新策略。
- 生产发布的下一步是恢复 SSH 可达后只读核对 VPS 状态与备份，再按文件级部署和回滚流程发布主线版本；不得整仓库强制切换或覆盖 VPS 既有本地改动。

## 2026-10-13 比赛评分细则适配（本地工作区）

- 按项目作品比赛评审细则新增 [`SCORING_ALIGNMENT.md`](SCORING_ALIGNMENT.md)，仅用于参赛材料/证据准备；攻防实验室内部规则与比赛分值分离，见 [`INTERNAL_SCORING.md`](INTERNAL_SCORING.md)。
- 后端本地改动为每次攻击/防守执行记录 correlationId、AIP session 关联、角色、调度模式、结果来源、耗时与脱敏失败类型；同步失败可用 `X-Battle-ID` 查询保留的失败事件。
- `/dashboard/summary` 和后台页新增留存战局中的 Agent/ACP 分项统计。历史战局没有逐调用事件，不会回填或推算这些指标；删除战局后其相关调用事件也被清理。
- 本地完整后端测试：比赛证据适配阶段 `107 passed, 4 skipped`；加入两侧内部评分后的当前完整测试结果见下节。跳过项因 Windows 环境缺少 Bash，另有既存 Starlette/httpx 弃用警告。敏感文件扫描通过。
- 当前 Partner 仍可能使用规则兜底；`reportedLlmResultCount` 是 Partner 自报来源字段。上述新改动尚未 Git 审核或生产部署，不能作为公网已上线证据。

## 2026-10-13 攻防实验室内部评分 v2（本地工作区）

- 新增攻击 Agent、防守 Agent 各自独立的 100 分制评分；根据样本/分析结构、测试设计/证据、调用完成和 correlationId 可追溯性计算，不合并胜负分，也不套用比赛作品评分。
- 内部后台战局详情展示两侧分数及分项；新增 `GET /battles/{id}/score`、`GET /internal-scores`，JSON 与 Markdown 战报也包含两侧评分。旧的攻防积分及 `/leaderboard` 保持不变。
- 没有逐 Agent 调用事件的历史战局会标为 `insufficient_evidence`；不将缺少证据记成零分。当前评分不代表攻击成功率、漏洞检出准确率、真实模型调用或目标修复效果。
- 评分优化：LLM 攻击样本补齐 `testVariation`；调用来源按成功调用的完整留痕比例计分；按通常四舍五入；规则版本为 `internal-agent-v2`，旧战局按当前版本实时重算。
- 当前完整后端测试：`113 passed, 4 skipped`；跳过项因 Windows 环境缺少 Bash，保留一条既存 Starlette/httpx 弃用警告。敏感文件扫描通过。
- 评分代码与页面改动已由 PR #6 合并到 `main`（`b00ca4b`），且已部署到隔离 API Preview；生产 API 尚未部署该评分版本。

## 2026-10-12 Redis 缓存生产部署（22:32-22:36 +08:00）

- 已将本地提交 `4895c5d` 中的 Redis 缓存实现定向部署到 VPS `/opt/agent-attack-lab/backend`：
  `src/agent_attack_lab/cache.py`、`src/agent_attack_lab/service.py`、`pyproject.toml`、`uv.lock`。
  VPS Git HEAD 仍为 `a0d62429c82a2ad122829dc8104f25505c0a22c8`；本次是保留现有未提交 `start-service.sh` 的文件级生产覆盖，不是整仓库切换。
- Redis 已安装在 VPS，版本 `6.4.0`，仅监听 `127.0.0.1:6379`/`::1:6379`；远端 `.env` 已配置
  `AGENT_REDIS_URL=redis://127.0.0.1:6379/0`、`AGENT_REDIS_TTL_SECONDS=30`，未上传或修改 `.env`。
- API 服务 `agent-attack-lab-api.service` 重启后保持 `active (running)`；本机 `/health`、`/dashboard/summary`、`/external-cases?limit=1` 均 HTTP 200，公网同三端点均 HTTP 200。
- Redis 实测出现 `agent-attack-lab:v1:dashboard-summary`（TTL 约 30 秒）和 external-cases 缓存键（TTL 约 300 秒）；服务日志未见 Redis 错误。Redis 失效时仍回退数据库。
- 生产回滚备份：`/opt/agent-attack-lab/.deploy-backups/redis-20261012-predeploy/`，包含覆盖前的 `service.py`、`pyproject.toml`、`uv.lock`；此前 `.deploy-backups/redis-20261012-/` 备份保留不动。
- 未修改 `backend/scripts/start-service.sh`、Cloudflare DNS/Tunnel、公网 Redis 暴露、数据库或证书。不要提交 VPS `.env`、Redis 数据、备份目录或其他凭据。

## 2026-10-12 Preview 验收复测（23:34-23:40 +08:00）

- Preview 页面与脚本 bundle 均 HTTP 200；bundle 指向 `https://preview-api.yuanyiagentzhandui.cn`，未发现生产 API 或 `127.0.0.1:8787` 地址。
- Preview API CORS POST 预检 HTTP 200，允许来源精确匹配 Preview Worker，允许方法 `GET, POST, DELETE, OPTIONS`。
- 隔离 Preview API 写验收：空白 topic HTTP 422；low/mid/high 均创建 HTTP 201 且状态 `completed`，详情 HTTP 200，事件分别 6/7/8 条；删除均 HTTP 204，随后详情及事件均 HTTP 404。验收主题记录复查为 0 条；此前一次状态解析失败留下的单条 Preview 测试记录也已删除并验证 404。未触碰生产战局数据库。
- 浏览器真实页面渲染、控制台、点击和移动端布局本轮无法验收：没有可连接的浏览器 CDP 会话，执行策略阻止启动独立 Edge 自动化进程。HTTP、bundle、API 验收不能替代人工浏览器交互。
- PR #4 当前 `APPROVED`、merge state `CLEAN`、仍为 OPEN。按验收要求，真实浏览器桌面/移动交互通过前不合并。

## 2026-10-12 验收复测（12:15-12:51 +08:00）

- 生产部署：VPS `/opt/agent-attack-lab` 当前提交 `a0d62429c82a2ad122829dc8104f25505c0a22c8`，与远端 `main` 一致。API、attacker、defender、preview 和 `cloudflared-agent-attack-lab` 用户服务均 `active` 且 `enabled`，user linger 为 `yes`。VPS 工作树另有 `backend/scripts/start-service.sh` 未提交修改，本轮未触碰。
- 公网只读：正式 API `/health`、`/dashboard/summary`、`/battles?limit=1`、`/external-cases?limit=1`、`/openapi.json` 均 HTTP 200；OpenAPI 包含 `DELETE /battles/{battle_id}`。正式站首页、`www`、隔离 Preview 首页和 Preview API `/health` 均 HTTP 200。正式前端 bundle 仅指向生产 API，Preview bundle 仅指向隔离 API；两者都未发现浏览器密码表单或 `/auth/session` 调用。
- CORS：正式前端 `https://www.yuanyiagentzhandui.cn` 到生产 API 的 POST 预检 HTTP 200；Preview Worker 到 `preview-api.yuanyiagentzhandui.cn` 的 POST 预检 HTTP 200，均返回匹配的 `Access-Control-Allow-Origin`，允许方法 `GET, POST, DELETE, OPTIONS`。
- 浏览器会话：未登录 `/auth/session` 为 `authenticated=false`；管理员凭据登录 HTTP 200，`Secure`、`HttpOnly`、`SameSite=Lax` Cookie 生效，登录后 `/dashboard` 返回管理页；两次已保存 Cookie 的验收会话均注销 HTTP 200。一次较早的受保护回放请求超时，未收到 X-Request-ID；对应临时 Cookie 未写盘或输出，服务端会话按 8 小时 TTL 到期（约 20:23 +08:00）。本轮单独登录探测也有一个未保留 Cookie 的会话，按 8 小时 TTL 自动过期（预计当日约 20:50，具体分钟无法确认）。未重启服务以免清除其他用户会话；不要将登录密码写入交接或 Git。
- Partner mTLS/AIP：attack、defense `/health` 均 HTTP 200；无客户端证书 `/rpc` 均 HTTP 403。使用 Leader clientAuth 与 trust bundle 分别执行 AIP Start、Complete，两边均 HTTP 200，响应结构通过，task 最终 `completed`；攻击返回 1 个 low 样本，防守返回合法检测结构。两边均为 `local-rule`，未调用外部模型。Leader 主 `/rpc` 未执行真实 mTLS 调用。
- Discovery：梧桐 Discovery explicit 查询命中 Leader、attack、defense 三个当前 AIC；均 `active=true`，RPC URL 与正式域名一致，`transport=JSONRPC`、security 声明 `mtls`。本轮未更新 Registry/Discovery。
- Cloudflare：当前账号 Tunnel `yuanyi-agent-attack-lab-backend` 为 `healthy`，远程配置版本 4；api/attack/defense/preview-api 分别映射到 VPS `127.0.0.1:8787/8788/8789/8790`。公网 DNS 查询成功；本账号 Zone 列表未返回 `yuanyiagentzhandui.cn`，因此没有读取或修改 Zone DNS 记录。
- 隔离 Preview 写验收：空白 topic HTTP 422；low/mid/high 均创建 HTTP 201 且状态 `completed`，读取事件分别为 6/7/8 条；删除均 HTTP 204，删除后查询均 HTTP 404。请求 ID：空主题 `req-d6b1cdc6-8ee6-4916-ae80-d1e876e6e232`；low create/delete `req-2fadfddc-eb49-471a-866e-d0e0a68f6d3d` / `req-b620240f-d4e1-459d-ae85-0ca05e5a919c`；mid `req-5ed6e1e4-19d6-4714-85af-ee9af885c329` / `req-33e0a989-fce7-40b8-9550-7e62a187ec79`；high `req-4b54b0a8-e8dc-4460-90c5-9f3d8a9c1d35` / `req-416db6e5-cda7-4f82-a4d6-ab02c60c462a`。本机隔离存储契约测试 `4 passed`，覆盖运行中战局删除 HTTP 409 与删除事件清理。
- 生产 Leader API 写验收（12:51:28-12:51:40 +08:00）：空 topic=422，request ID `req-f3f09b94-4d6d-400d-8e0a-e51230e71f08`。独特前缀 `[prod-accept-20261012-125128]` 下 low/mid/high 均创建 201、完成后删除 204；删除后战局详情及事件查询均 404。low create/delete `req-c08f72fb-e20f-4f37-a80d-2cea170fe357` / `req-a4363247-d97b-4251-b076-4216f55d30e2`（6 events）；mid `req-9de463d4-dbd9-49d3-8ad8-9e4a88a74527` / `req-2673e85a-e96a-48fb-b917-da448386d612`（7 events）；high `req-e7046f0d-3d22-4a4c-bdd6-b07d227dd9b1` / `req-65f0ced9-3b3d-45a0-b6a2-0f95675e4775`（8 events）。三个难度均返回 `agentSource=acp-rule-fallback`，表明 Leader 已通过 ACP 调用 Partner，Partner 使用本地规则；没有调用外部 LLM。测试战局及事件均已清理。
- 边界：生产 `/battles` 写接口 low/mid/high 与 Partner 链路已验收；运行中删除 409 由本机隔离存储契约测试覆盖，本轮未在生产制造运行中战局。Leader 自身 `/rpc` 直连调用、Discovery 到生产战局的完整链路和真实浏览器页面交互仍未验收。Browser automation 未能启动（Node REPL 没有浏览器句柄，本机 Edge 未开启远程调试端口）；HTTP/静态 bundle 检查不替代页面交互验收。

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
