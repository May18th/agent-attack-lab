# 前端待办清单

## 新增待办：队友域名前后端上线

更新时间：2026-10-08。队友提供的域名为 `yuanyiagentzhandui.cn`。该域名属于队友；当前尚未确认 Cloudflare Zone、网站托管和公网 DNS 已配置完成。以下为上线前待办，不代表公网服务已可用。

本节是当前域名安排的唯一有效指令，优先于本文后续 2026-10-07 的历史公网地址说明。项目使用队友新域名；本人原有域名不属于本项目，不配置、不迁移、不作为备用地址。

### 建议地址分工

| 用途 | 建议地址 | 负责事项 |
|---|---|---|
| 前端网页 | `https://yuanyiagentzhandui.cn`（或队友确认的 `www` 地址） | 队友选择并部署前端托管，配置域名和 HTTPS；本机 `localhost:5173` 仅用于本地开发 |
| 网页后端 API | `https://api.yuanyiagentzhandui.cn` | 后端负责人在该域名所属 Cloudflare 账户中配置 Tunnel，连接后端主机的 `127.0.0.1:8787` |
| 平台 RPC（如需） | `https://api.yuanyiagentzhandui.cn/rpc` | 与网页 REST API 分开验收；不得因只开放 `/rpc` 而误以为前端已联通 |

### 按负责人执行

**队友（域名及前端）**

1. 确认 `yuanyiagentzhandui.cn` 已添加到其 Cloudflare 账户并处于 Active 状态；确认前端托管方式（现有托管平台、Cloudflare Pages/Workers 等）及最终网页源站地址。
2. 配置根域名或约定的 `www` 子域名指向前端托管并启用 HTTPS。
3. 将域名 Zone 管理权限授予后端负责人，或与后端负责人协同在同一个 Cloudflare 账户内创建后端 Tunnel。不要在聊天、仓库或 `.env` 示例中发送 API Token、Tunnel Token、私钥。
4. 等后端负责人确认 API 已公网验收且给出正式地址后，再在前端 `.env.local` 配置：

```env
VITE_AGENT_API=https://api.yuanyiagentzhandui.cn
```

5. 重新启动前端并验收：网页可通过 HTTPS 打开，能读取 `/health`、`/dashboard/summary`、创建和查询战局；记录前端地址、API 地址、Git 提交版本和失败请求的 `X-Request-ID`。

6. 若公网启用浏览器登录，在页面增加密码登录/退出状态；登录请求调用 `POST /auth/session`，启动时调用 `GET /auth/session`，退出调用 `DELETE /auth/session`。所有需要登录的 API fetch 设置 `credentials: "include"`；不要在 `VITE_*` 中配置后端 API Key。EventSource 使用 `withCredentials: true`。本地 HTTP 联调时前后端 API 使用同一主机名 `localhost`，API 地址可设为 `http://localhost:8787`。

### 当前新增：Cloudflare 构建失败修复（队友执行）

GitHub PR `#1` 的代码冲突已由后端负责人合并，当前分支提交为 `7def217`。GitHub 后端测试、前端测试和生产构建均通过；Cloudflare 的 `Workers Builds: agent-attack-lab` 仍失败，需要按下面步骤处理。

1. 打开 Cloudflare `agent-attack-lab` 构建详情，查看提交 `7def217` 的失败日志，并在回执中保留第一条实际错误；不要只回报“Build failed”。
2. 当前仓库前端是 Vite 静态应用，前端目录为 `frontend/frontend-ui`，仓库没有根目录 `package.json`，也没有 `wrangler.jsonc`。若使用 **Cloudflare Pages**，构建设置固定为：

   ```text
   Root directory: frontend/frontend-ui
   Build command: npm ci && npm run build
   Build output directory: dist
   ```

3. 如果当前 Cloudflare 项目是 **Workers Builds**，不要直接把整个仓库当 Worker 部署。请先在 Pages 和 Workers Static Assets 之间确认一种方案；改用 Workers 必须补齐 Worker 配置后再部署，不能仅修改构建命令冒充成功。
4. 前端 API 地址暂时不要填写未验收的公网地址。等后端确认 `https://api.yuanyiagentzhandui.cn/health` 返回 JSON `200` 后，再设置 `VITE_AGENT_API` 并重新构建。
5. 检查生产访问路径：`frontend/frontend-ui/vite.config.ts` 当前生产 `base` 为 `/ui/`。若最终网站从域名根路径打开，应确认是否访问 `/ui/`；若要求根路径 `/`，先回报后再改 `base`，不要自行改后端路由。
6. 重新触发 Cloudflare 预览构建，回执必须包含：构建平台（Pages/Workers）、根目录、构建命令、输出目录、预览地址、提交版本和失败日志或成功日志。

本地已补齐 Workers Static Assets 部署配置：`frontend/frontend-ui/wrangler.jsonc` 将 `dist` 声明为静态资源目录，`package.json` 提供 `npm run deploy`。若继续使用 Workers Builds，请将项目根目录设为 `frontend/frontend-ui`，构建命令设为 `npm run build`，部署命令设为 `npx wrangler deploy`（或 `npm run deploy`，二者不要同时执行构建），并确认生产入口仍按当前 Vite 配置使用 `/ui/` 路径。该配置不会创建或修改队友账号中的 Build trigger；线上失败日志仍需在对应 Cloudflare 账号回执。

队友不需要修改后端 Python、DNS、旧 `kcwx.online` 资源，也不要把 API Key、Tunnel Token 或私钥放入仓库或前端变量。

**后端负责人（8787 服务）**

1. 先取得队友域名所属 Cloudflare Zone 的必要权限。Tunnel 与目标 DNS 记录必须由同一 Cloudflare 账户管理；现有其他账户的 Tunnel 不能直接替代。
2. 将 `api.yuanyiagentzhandui.cn` 的 Tunnel Connector 运行在后端主机，并转发到 `http://127.0.0.1:8787`。仅转发 `/rpc` 不足以支持当前网页；前端实际调用 `/health`、`/dashboard/summary`、`/battles` 和 `/battles/{battle_id}`。
3. 上线前核对公开路由、`AGENT_API_KEY`、`AGENT_PROTECT_READS`、限流和 CORS。不得把后端 API Key 放入 Vite 前端变量；浏览器使用后端 `/auth/session` 会话接口，具体方式见 `docs/FRONTEND_TO_BACKEND_HANDOFF.md`。
4. 默认不公开 `/metrics`、`/docs`、`/openapi.json`、内部 Agent 管理接口和后台管理页面。若平台只需要 RPC，单独确认 `/rpc` 的鉴权、证书要求和验收方式。
5. 确认最终前端 Origin 后，将其精确加入后端 CORS 白名单；不要使用过宽的通配来源。

### 切换和验收边界

- 新地址验收通过前，使用本机后端进行本地开发；跨电脑远程联调须等待队友域名下的 API 完成验收，不要临时改用本人原有域名。
- 不要修改或删除本人原有域名、旧 DNS、旧 Tunnel；它们不属于本项目，可能有其他用途。
- 公网 DNS 目前尚未确认有可用的网站记录。注册了域名不等于前端网站和后端 API 已上线。
- 只有前端 HTTPS 页面、浏览器 CORS、鉴权、`low/mid/high` 创建战局、历史列表和详情均通过，才回填“前后端公网联调完成”。

### 队友回执

```text
域名前后端部署回执：

1. Cloudflare Zone 状态及管理账户确认：
2. 前端托管平台及最终 HTTPS 地址：
3. 后端 API HTTPS 地址：
4. 前端 VITE_AGENT_API：
5. /health 与 /dashboard/summary：
6. 创建 low/mid/high 战局：
7. 历史列表和详情：
8. 浏览器 CORS/鉴权结果：
9. Git 提交版本：
10. 未解决问题及 X-Request-ID：
```

## 当前优先待办（请先完成）

> 更新时间：2026-10-07。完成后请在 GitHub Issue 或提交说明中回填结果。

### Dashboard 修复状态

- [x] 统计摘要读取后端独立聚合的规则库用例、已保存样本、规则命中、风险记录和 ACP 调用场次数；口径说明明确。当前真实历史数据中后三项碰巧均为 131，未做人为改数。
- [x] `?topic=...&difficulty=...` 打开时预填表单，无参数时保留默认主题与难度。
- [x] 历史记录按服务端 `limit/offset` 分页，搜索使用后端 `q` 和筛选总数响应头 `X-Total-Count`。
- [x] 选择历史战局后 URL 写入 `?battle_id=...`，刷新后恢复该战局。
- [x] 统计用例库规模与历史保存样本数分开说明；ACP 调用场次解释为成功调用独立 Agent 的战局数，不代表真实目标验证。

本轮本地验证：后端 40 项、前端 15 项测试通过；前端 `npm run build`、`npm run lint` 通过；桌面和 390px 手机视口截图通过。尚未替代队友在公网后端上的 low/mid/high 远程联调回执。

### 新增同步：`agentSource` 来源枚举

后端战局响应的 `attackerOut.agentSource` / `defenderOut.agentSource` 扩展为三种值。若 5173 Vite 前端消费或展示该字段，请按以下映射兼容；不要把未知值默认显示为「本地规则」：

| 值 | 建议中文显示 | 含义 |
|---|---|---|
| `acp-llm` | 独立 Agent（模型生成） | 独立 ACP Agent 调用模型成功 |
| `acp-rule-fallback` | 独立 Agent（规则兜底） | ACP Agent 可调用，但模型失败或输出无效，Agent 内部回退规则 |
| `local-rule` | 本地规则引擎 | 未配置/未调用独立 ACP Agent，由主服务本地规则处理 |

若字段缺失或收到未知值，请显示「来源未知」并保留原值用于排查，不要冒称模型生成。此项只要求前端消费字段时更新类型和标签映射；不要求修改页面流程或后端代码。

### 公网状态（后端负责人处理）

2026-10-08 确认队友的新域名尚未完成托管、DNS 和后端 API 配置。跨电脑远程联调暂缓；本地开发时仅在前后端同机运行的情况下将 `VITE_AGENT_API` 指向 `http://127.0.0.1:8787`。新域名 API 上线后，每次远程联调前先检查 `/health`，失败时暂停验收并记录状态码、时间、响应头和 `X-Request-ID`。

| 顺序 | 待办 | 操作 | 完成标准 |
|---|---|---|---|
| 0 | 兼容 `agentSource` 三态 | 若页面展示来源，更新 TS 类型、标签映射及未知值处理 | 三种来源均显示正确中文；未知值显示「来源未知」；未冒称 LLM |
| 1 | 拉取最新代码 | `git pull origin main` | 已包含最新 `vite.config.ts` 和联调文档 |
| 2 | 确认目录 | 进入 `frontend/frontend-ui` | 当前目录存在 `package.json` |
| 3 | 配置后端地址 | 同机本地开发使用 `http://127.0.0.1:8787`；远程联调等待后端负责人确认新域名 API 已验收后配置 | 不使用本人原有域名；不得提前填写未验收地址 |
| 4 | 安装并启动前端 | `npm install`；`npm run dev -- --host 0.0.0.0` | `http://localhost:5173` 可打开 |
| 5 | 启动前端公网 Tunnel | `cloudflared tunnel --url http://127.0.0.1:5173` | 生成新的 `https://*.trycloudflare.com` 地址 |
| 6 | 完成主流程联调 | 分别测试 `low`、`mid`、`high` | 页面显示攻击样本、caught、risks、fixed |
| 7 | 验收异常状态 | 空主题、超长主题、重复点击、网络失败 | 页面显示中文提示，不显示堆栈 |
| 8 | 提交联调回执 | 按本文末尾模板填写 | 包含公网前端地址和已知问题 |

### 队友直接执行的命令

```powershell
git pull origin main
cd frontend\frontend-ui
npm install
# 仅当后端也运行在本机时使用此地址；跨电脑联调等待新公网 API 验收完成
Set-Content .env.local "VITE_AGENT_API=http://127.0.0.1:8787"
npm run dev -- --host 0.0.0.0
```

另开一个 PowerShell 窗口启动临时前端公网地址：

```powershell
cd frontend\frontend-ui
cloudflared tunnel --url http://127.0.0.1:5173
```

把命令输出的最新 `https://*.trycloudflare.com` 地址发回。Tunnel 窗口不能关闭，否则会出现 Cloudflare `1033` 或 `530`。

### 固定联调约定

- 后端 API 正式地址待队友域名下的 Tunnel 配置和公网验收完成后公布；当前跨电脑联调暂停。
- 前端页面临时地址以队友 Tunnel 终端输出为准，旧地址失效后不要继续使用。
- 域名属于队友，DNS/Tunnel 操作须在域名所属 Cloudflare 账户进行；不需要向前端队友发送 Tunnel 凭据、API Token、数据库或证书。
- `api.orangecc.cc` 是外部 AI 网关，不能配置为 `VITE_AGENT_API`。
- Vite 报 `Blocked request` 时先 `git pull origin main`，再重启 Vite；不要改 DNS。

### 前端联调回执（必须填写）

```text
前端联调回执：

1. 当前提交版本：
2. 前端本地地址：
3. 前端公网地址：
4. VITE_AGENT_API：
5. low 对抗：成功/失败
6. mid 对抗：成功/失败
7. high 对抗：成功/失败
8. attackerOut.samples 展示：成功/失败
9. defenderOut（caught/risks/fixed）展示：成功/失败
10. 历史列表和详情：成功/失败
11. npm run lint/build：
12. 当前问题、截图和 X-Request-ID：
13. 需要后端配合：
```

## P0 必须完成

| 编号 | 待办 | 后端依赖 | 验收标准 |
|---|---|---|---|
| FE-01 | 将 React + TypeScript 工程整理到 frontend/ | 无 | npm install 和 npm run dev 可启动 |
| FE-02 | 配置 .env.example 和 .env.local | VITE_AGENT_API | 切换本地/公网后端只改环境变量 |
| FE-03 | 建立统一 API 客户端和类型 | /battles 契约 | 统一处理请求、状态和网络错误 |
| FE-04 | 完成主题输入和难度选择 | low/mid/high；topic 最大 200 字符 | 空值、超长、重复提交有提示 |
| FE-05 | 接入 POST /battles | id/status/createdAt/attackerOut/defenderOut | low、mid、high 各成功创建一局 |
| FE-06 | 展示 attackerOut.samples | type/topic/severity/content | 列表、空数组和长文本正常展示 |
| FE-07 | 展示 defenderOut.caught/risks/fixed | 三组数组 | 三组结果可展示，空数组有状态 |
| FE-08 | 展示战局 ID、状态、创建时间 | 元信息字段 | 能确认当前战局身份 |
| FE-09 | 处理加载、成功、空结果、422、404、5xx、网络失败 | 稳定状态码和错误结构 | 中文提示清晰，不显示堆栈 |
| FE-10 | 完成首轮联调 | 后端服务、CORS、固定样例 | 从输入到完整战况连续跑通 |

## P1 应完成

| 编号 | 待办 | 后端依赖 |
|---|---|---|
| FE-11 | 历史战局列表 | GET /battles |
| FE-12 | 战局详情恢复 | GET /battles/{battle_id} |
| FE-13 | 健康状态提示 | GET /health |
| FE-14 | 样本和错误文本安全展示 | 纯文本渲染 |
| FE-15 | 响应式演示布局 | 桌面和窄屏不溢出 |
| FE-16 | API、表单和结果区测试 | 成功、空结果、422、5xx、网络失败 |

## P2 后续扩展

- /rpc 调试入口。
- WebSocket 实时战况。
- arbiter、score、round、correlationId 和事件时间线。
- 战局导出、比较和筛选。

## 前后端接应节点

| 节点 | 前端交付 | 后端同步交付 | 联调输出 |
|---|---|---|---|
| N1 工程可运行 | FE-01、FE-02 | BE-07：本地和公网 CORS | 前端启动并访问 /health |
| N2 API 可调用 | FE-03、FE-04 | BE-01、BE-02、BE-09：契约、错误和文档 | 同一份请求和响应样例 |
| N3 主流程贯通 | FE-05 至 FE-08 | BE-03 至 BE-05：攻击、防守和战局编排 | low/high 完整战况截图或录屏 |
| N4 异常可验收 | FE-09 | BE-02、BE-08：错误格式和自动化测试 | 422、404、5xx、网络失败检查表 |
| N5 历史与恢复 | FE-11、FE-12 | BE-06、BE-10：列表、详情和查询优化 | 创建、列表、详情、刷新恢复闭环 |
| N6 演示冻结 | FE-10、FE-15、FE-16 | BE-08、BE-09、BE-14：测试、文档和运行手册 | 最终演示版本和验收记录 |

