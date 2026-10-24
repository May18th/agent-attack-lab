# 管理员后台功能补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补齐管理员后台的战局创建、样本库、规则库、审计日志和战局导出能力。

**Architecture:** FastAPI 增加受管理员会话保护的资源接口与持久化表，React `AdminApp` 增加模块导航、表单和导出工具，所有功能复用现有 `adminApi` 请求层和深色后台样式。

**Tech Stack:** React 19 + TypeScript + Vite + Vitest；FastAPI + Pydantic + SQLite/PostgreSQL/MySQL 兼容 `BattleStore`。

**Spec:** `docs/superpowers/specs/2026-10-24-admin-management-design.md`

## Global Constraints

- 不改变现有管理员密码认证接口。
- 不新增 OpenAI 或第三方服务。
- 管理接口必须经过管理员会话或 API key 校验。
- 导出数据不得包含密码、令牌或未清洗敏感字段。
- 3D 节点布局和已有回放逻辑保持不变。

## Tasks

- [ ] 任务 1：扩展 `BattleStore`，增加样本、规则 CRUD 和通用审计筛选，补充 SQLite/数据库兼容测试。
- [ ] 任务 2：在 `service.py` 增加管理员样本/规则/审计接口，创建战局时记录操作审计，补充 FastAPI API 测试。
- [ ] 任务 3：扩展 `adminApi.ts` 类型和请求函数，补充请求层测试。
- [ ] 任务 4：扩展 `AdminApp.tsx` 和样式，加入创建战局、样本库、规则库、审计日志、CSV/PDF 导出及组件测试。
- [ ] 任务 5：运行前后端全量验证、构建和差异审查，更新部署记忆但不自动部署生产。

## Verification

- `backend/.venv/Scripts/python.exe -m pytest backend/tests -q`
- `npm test -- --run`（`frontend/frontend-ui`）
- `npm run build:production`（`frontend/frontend-ui`）
- `git diff --check`
