# 智能体攻防实验室协作边界

## 1. 项目边界

- 本项目名称：智能体攻防实验室。
- 本项目与其他科创项目完全独立。
- GitHub 主仓库：`https://github.com/May18th/agent-attack-lab`。
- 默认分支：`main`。

## 2. 后端负责人职责

- 维护 `backend/src/` 中的 FastAPI、Agent、AIP/JSON-RPC 和存储逻辑。
- 维护 `backend/tests/`，确保接口行为有测试覆盖。
- 维护 `backend/pyproject.toml`、`uv.lock`、启动脚本和后端接口文档。
- 负责请求校验、错误码、CORS、数据库和公网服务。
- 负责 AIC、CAI、ACS、mTLS 证书及平台注册事项。
- 后端字段或接口变更前，必须先通知前端负责人。

## 3. 前端负责人职责

- 维护前端页面、组件、样式、交互和状态管理。
- 负责输入控件、加载中、成功、空结果、422 和 5xx 状态展示。
- 通过 `VITE_AGENT_API` 读取后端地址，不在组件中写死地址。
- 第一版主流程调用 `POST /battles`，展示攻击样本和防守结果。
- 前端不得修改后端接口字段、数据库、AIP/JSON-RPC 实现或证书配置。
- 前端不需要接触 AIC、CAI、ACS、mTLS 私钥和 `.data`。

## 4. 共享文件和禁止修改项

可共同维护：

- `docs/`
- 根目录 `README.md`
- `frontend/FRONTEND_TEAM_MESSAGE.md`

后端专属：

- `backend/src/`
- `backend/tests/`
- `backend/pyproject.toml`
- `backend/uv.lock`
- `backend/.data/`
- `backend/.venv/`

禁止提交或传播：

- `.venv/`
- `.data/`
- `*.log`
- `*.pem`、`*.key`、`*.p12`、`*.pfx`
- ACS 注册文件和任何私钥

## 5. 接口变更规则

1. 先在 Issue 或协作消息中说明变更原因和影响。
2. 后端更新接口文档和测试。
3. 前端确认字段和错误处理方式。
4. 变更完成后再合并到 `main`。

第一版稳定接口：

- `GET /health`
- `POST /battles`
- `GET /battles`
- `GET /battles/{battle_id}`
- `POST /agent/attack`
- `POST /agent/defend`
- `POST /rpc`

未经双方确认，不删除或重命名已有字段。

## 6. Git 协作流程

不要直接在 `main` 上开发：

```powershell
git pull origin main
git checkout -b feature/your-change
git add .
git commit -m "describe your change"
git push -u origin feature/your-change
```

通过 Pull Request 合并到 `main`。提交前检查：

```powershell
cd "D:\梧桐\backend"
.\verify.ps1
```

## 7. 联调地址

- 本地：`http://127.0.0.1:8787`
- 临时公网地址以 `docs/TEAM_HANDOFF.md` 当前记录为准。

公网 Tunnel 是临时资源，地址变化时只更新文档和前端环境变量，不修改接口路径。

## 8. 任务文件统一入口

所有任务分工和边界只以本文件为准，不再新建零散的任务说明文件。

### 我的后端任务

```text
backend/src/          FastAPI、Agent、AIP/JSON-RPC、存储
backend/tests/        后端测试
backend/pyproject.toml
backend/uv.lock
backend/start.ps1
backend/restart.ps1
backend/verify.ps1
```

已完成：后端接口、SQLite 存储、AIP/JSON-RPC、CORS、测试、D 盘部署和公网联调。

后续负责：接口修复、测试维护、公网服务、平台接入和前端 Pull Request 审核。

### 队友的前端任务

```text
frontend/             前端源码和前端材料
frontend/.env.local   本地环境变量，不提交
```

当前任务：

1. 从 `VITE_AGENT_API` 读取后端地址。
2. 接入 `POST /battles`。
3. 展示 `attackerOut.samples`。
4. 展示 `defenderOut` 的 `caught`、`risks`、`fixed`。
5. 处理加载中、空结果、422 和 5xx。
6. 在独立分支提交 Pull Request。

### 共同维护的文件

```text
README.md
docs/TEAM_HANDOFF.md
docs/frontend-integration.md
docs/PROJECT_RULES.md
docs/COLLABORATION_BOUNDARIES.md
frontend/FRONTEND_TEAM_MESSAGE.md
```

接口变更、目录移动和任务调整必须先更新本文件，再通知对方。第一版暂不安排 WebSocket、arbiter、score、round、correlationId 和 connected 事件。

### 验收命令

后端提交前统一执行：

```powershell
cd "D:\梧桐\backend"
.\verify.ps1
```

## 9. 统一待办与状态

外部收到的 `BACKEND_TODO.md` 和 `FRONTEND_TODO.md` 已合并到本节；项目内不再单独维护两份重复清单。

### 后端 P0

| 编号 | 状态 | 说明 |
|---|---|---|
| BE-01 至 BE-07 | 已完成 | 接口契约、校验、攻击、防守、战局编排、历史接口和 CORS 已实现 |
| BE-08 | 已完成 | 自动化测试覆盖 health、battles、404、422、defend、RPC、列表参数和 SQLite 持久化 |
| BE-09 | 已完成 | `/docs`、README 和前端交接文档已同步 |

### 后端 P1

| 编号 | 状态 | 说明 |
|---|---|---|
| BE-10 | 已完成 | `GET /battles?limit=1..200` 已提供 |
| BE-11 | 待评估 | 当前 `/health` 已返回服务状态；更详细指标不阻塞第一版 |
| BE-12 | 后续 | 统一请求日志关联，等实时功能确定后实施 |
| BE-13 | 后续 | arbiter 扩展边界暂不实现 |
| BE-14 | 已完成 | `docs/DEPLOYMENT.md` 已提供公网服务、Quick Tunnel、稳定 Tunnel 和数据库配置说明 |

### 前端 P0

| 编号 | 状态 | 说明 |
|---|---|---|
| FE-01 至 FE-02 | 待队友提交 | 前端工程和环境变量必须进入 `frontend/` |
| FE-03 至 FE-10 | 待联调 | API 客户端、表单、主流程、结果展示和异常状态 |

### 前端 P1/P2

- FE-11 至 FE-13：历史战局和健康状态，后端接口已准备好。
- FE-14 至 FE-16：安全展示、响应式布局和前端测试，等待前端源码恢复后验收。
- WebSocket、arbiter、score、round、correlationId、事件时间线属于 P2，不阻塞第一版。

### 当前阶段

GitHub `main` 分支已经包含 `frontend/frontend-ui` 的前端源码。当前进入 N1-N6 联调验收：队友拉取最新代码后，确认环境变量、主流程、异常状态、响应式布局和前端测试。
