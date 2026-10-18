# Backend Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 FastAPI 战局后端中补齐持久化审计、幂等、超时/取消、ACP 重试和指标能力。

**Architecture:** 沿用 `service.py` 的 FastAPI 路由和 `storage.py` 的多数据库适配，在三种数据库初始化路径及 Alembic 中增加同一张 `audit_events` 表。请求级状态留在服务进程，持久化数据只保存脱敏关联信息；不改变既有战局 API 结构。

**Tech Stack:** Python 3.14、FastAPI、Pydantic、SQLite/PostgreSQL/MySQL、Alembic、Redis、pytest。

**Spec:** `docs/superpowers/specs/2026-10-18-backend-reliability-design.md`

## Global Constraints

- 不迁移 Django，不引入课程系统、CTF、Docker/KVM 靶场或外部 LLM/API。
- 不改前端，不提交 `.env`、Token、证书、私钥、数据库、日志和长期记忆。
- 公开 API 的现有状态码、响应字段和评分规则保持兼容。
- 审计数据必须脱敏，不能保存密钥、私钥或原始敏感 payload。

## Review Focus

- 相同幂等键但参数不同必须返回 `409`，不能复用错误战局。
- 重启恢复时不能重复接管已完成或已取消的战局。
- 超时和取消必须是幂等的，不能把已完成战局改回失败。
- ACP 重试只能覆盖可重试的临时错误，并且最终错误不得泄露敏感内容。
- SQLite、PostgreSQL、MySQL 的初始化和迁移必须保持同构。

### Task 1: Audit persistence

**Files:**
- Modify: `backend/src/agent_attack_lab/storage.py`
- Create: `backend/alembic/versions/20261018_0003_audit_events.py`
- Test: `backend/tests/test_storage_audit.py`

- [ ] 写失败测试：三种字段关联可保存/读取，删除战局时级联删除 battle audit，敏感键不进入 data。
- [ ] 运行 `pytest backend/tests/test_storage_audit.py -q`，确认因接口不存在失败。
- [ ] 在三种 schema 初始化路径和 Alembic 迁移中创建 `audit_events`，增加 `save_audit_event`、`list_audit_events`、`count_audit_events`。
- [ ] 运行专项测试和现有 storage 测试。

### Task 2: Idempotent battle creation

**Files:**
- Modify: `backend/src/agent_attack_lab/service.py`
- Test: `backend/tests/test_service.py`

- [ ] 写失败测试：后台创建带 `Idempotency-Key` 时重复请求返回原战局；同键不同 topic/difficulty 返回 `409`。
- [ ] 运行目标测试确认失败。
- [ ] 使用脱敏请求指纹和进程内短期索引实现兼容行为，并写入 audit event；不改变无幂等键的现有行为。
- [ ] 运行目标测试和服务全量测试。

### Task 3: Timeout and cancellation

**Files:**
- Modify: `backend/src/agent_attack_lab/service.py`
- Test: `backend/tests/test_service.py`

- [ ] 写失败测试：超时战局产生 `battle.timeout`；取消运行中战局返回 `202`，重复/终态取消返回 `409`。
- [ ] 运行目标测试确认失败。
- [ ] 增加 `AGENT_BATTLE_TIMEOUT_SECONDS`，维护任务取消句柄，新增 `POST /battles/{battle_id}/cancel`；超时和取消只允许 pending/running 转换。
- [ ] 在启动恢复时过滤终态并记录审计。
- [ ] 运行全量测试。

### Task 4: ACP retry and metrics

**Files:**
- Modify: `backend/src/agent_attack_lab/acp_agents.py`, `backend/src/agent_attack_lab/service.py`
- Test: `backend/tests/test_acp_agents.py`, `backend/tests/test_service.py`

- [ ] 写失败测试：临时网络错误按 `AGENT_RPC_RETRIES` 重试并成功；超过次数后抛出原有 `ACPAgentError`；metrics 暴露 retry/timeout/cancel/audit 计数。
- [ ] 运行目标测试确认失败。
- [ ] 只对连接、超时和 5xx 类临时故障重试，采用 0.1 秒起步、封顶 0.5 秒的指数退避；复用已有 mTLS 配置和脱敏错误。
- [ ] 增加运行计数并写入 `/metrics`，不改变现有鉴权。
- [ ] 运行全量测试及 `uv run pytest -q`。

### Task 5: Documentation and verification

**Files:**
- Modify: `backend/.env.example`, `backend/README.md`, `docs/TEAM_HANDOFF.md`（若存在）

- [ ] 补充超时、重试、幂等、取消和审计配置说明。
- [ ] 运行敏感文件检查、全量测试、Git diff 检查。
- [ ] 只提交代码、迁移、测试和文档，不提交运行数据。
