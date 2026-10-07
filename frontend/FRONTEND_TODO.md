# 前端待办清单

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

2026-10-07 本轮检查中，`https://api.kcwx.online/health` 曾返回 Cloudflare 502/530，随后恢复 HTTP 200；本机后台始终返回 200。公网依赖后端主机和 Cloudflare Tunnel，存在短时波动；每次远程联调前请重查 `/health`，失败时先暂停远程验收。队友如需先开发，可把 `VITE_AGENT_API` 指向自己的本地后端；不要修改 DNS，也不需要登录后端 Cloudflare 账号。复测失败时记录状态码、时间和响应头并回报后端负责人。

| 顺序 | 待办 | 操作 | 完成标准 |
|---|---|---|---|
| 0 | 兼容 `agentSource` 三态 | 若页面展示来源，更新 TS 类型、标签映射及未知值处理 | 三种来源均显示正确中文；未知值显示「来源未知」；未冒称 LLM |
| 1 | 拉取最新代码 | `git pull origin main` | 已包含最新 `vite.config.ts` 和联调文档 |
| 2 | 确认目录 | 进入 `frontend/frontend-ui` | 当前目录存在 `package.json` |
| 3 | 配置后端地址 | `.env.local` 写入 `VITE_AGENT_API=https://api.kcwx.online` | 不使用旧 Quick Tunnel 后端地址 |
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
Set-Content .env.local "VITE_AGENT_API=https://api.kcwx.online"
npm run dev -- --host 0.0.0.0
```

另开一个 PowerShell 窗口启动临时前端公网地址：

```powershell
cd frontend\frontend-ui
cloudflared tunnel --url http://127.0.0.1:5173
```

把命令输出的最新 `https://*.trycloudflare.com` 地址发回。Tunnel 窗口不能关闭，否则会出现 Cloudflare `1033` 或 `530`。

### 固定联调约定

- 后端 API 固定使用：`https://api.kcwx.online`。
- 前端页面临时地址以队友 Tunnel 终端输出为准，旧地址失效后不要继续使用。
- 不需要队友登录我的 Cloudflare 账号，也不需要 Tunnel 凭据、API Token、数据库或证书。
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

