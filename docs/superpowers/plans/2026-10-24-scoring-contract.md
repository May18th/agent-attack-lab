# 前台评分契约与战局展示对齐 Implementation Plan

> **For agentic workers:** 直接在当前会话按任务单执行，步骤使用 checkbox 跟踪。

**Goal:** 将后端评分切换为 `frontend-v1`，补齐回合聚合、战局编号、统计和 Admin 样本/规则/审计管理，并保持 SQLite/MySQL/PostgreSQL 兼容。

**Architecture:** 保留现有 `BattleStore`、FastAPI 服务与 React AdminApp 边界；评分逻辑集中在 `scoring.py`，回合聚合由 service 基于事件快照完成，`battles.code` 通过 Alembic 新迁移和存储初始化兼容补列。前端只扩展类型、API 封装和 AdminApp tab，不改变鉴权、事件流和既有战局接口。

**Tech Stack:** Python, FastAPI, SQLite/MySQL/PostgreSQL SQL branches, Alembic, React/TypeScript, Vitest, pytest.

**Spec:** `codex/CODEX_TASK_20261024_scoring_contract.md`

## Global Constraints

- 不改 `battles` / `battle_events` 既有列；`code` 只走新增迁移。
- 不删/不改现有接口签名；新增字段一律可选、向后兼容。
- 不动鉴权 / 限流 / 幂等 / 审计 / 事件流 / WebSocket。
- 三库 SQL 分支覆盖；不提交 `.env`、证书、`.data/`。

## Review Focus

- 历史 `internal-agent-v2` 评分读取必须保持可展示，新战局写入 `frontend-v1`。
- 缺失回合事件不能导致 `/rounds` 500，字段应返回 `null` 或空数组。
- 旧 battles 表升级后 `code` 可空且创建编号单调唯一。
- 评分响应分边界、四舍五入和角色无调用证据状态必须稳定。
- Admin CRUD 表单必须沿用会话鉴权且不破坏现有战局详情加载。

### Task 1: 评分契约迁移

**Files:** `backend/src/agent_attack_lab/scoring.py`, `backend/tests/test_scoring.py`, `frontend/frontend-ui/src/api.ts`

- [ ] 写失败测试：权重合计 40、前台公式示例、`frontend-v1`、summary/group 与响应分边界。
- [ ] 实现流程分 5 项、效果分 60、响应分 100、最终分公式和兼容结构。
- [ ] 验证评分单测及旧快照读取分支。

### Task 2: 回合聚合与统计接口

**Files:** `backend/src/agent_attack_lab/service.py`, `backend/src/agent_attack_lab/storage.py`, `backend/tests/test_service.py`

- [ ] 写失败测试覆盖 `/battles/{id}/rounds` 聚合、缺失事件容错和四项统计。
- [ ] 实现回合聚合、stats 和 dashboard_summary 字段。
- [ ] 验证服务测试。

### Task 3: 战局编号与迁移

**Files:** `backend/alembic/versions/20261024_0004_battle_code.py`, `backend/src/agent_attack_lab/storage.py`, `backend/src/agent_attack_lab/service.py`, storage tests

- [ ] 写失败测试验证 `A-001` 编号、旧数据可空及三库 SQL 分支。
- [ ] 实现迁移、序列表/等价取号、BattleRecord code 字段和前端回退。
- [ ] 验证迁移脚本和 SQLite 存储测试。

### Task 4: Admin API/UI 接入

**Files:** `frontend/frontend-ui/src/adminApi.ts`, `frontend/frontend-ui/src/AdminApp.tsx`, `frontend/frontend-ui/src/AdminApp.css`, frontend tests

- [ ] 写失败测试验证 7 类 API 方法和三个 tab 可见。
- [ ] 实现样本库、规则库、审计日志列表/搜索/新增/编辑/删除弹窗。
- [ ] 验证 Vitest 和 TypeScript build。

### Task 5: 全量验收

- [ ] 运行 backend pytest、frontend npm test/build、敏感文件检查。
- [ ] 检查 diff 只包含本任务相关变更并记录未能实际连接的数据库验证项。
