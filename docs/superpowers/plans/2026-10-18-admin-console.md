# 管理后台入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 React 前端增加基于真实 FastAPI 接口的管理员后台入口。

**Architecture:** 保留当前公开 `App`，由 `main.tsx` 按路径选择 `/admin` 的 `AdminApp`。API 调用集中在 `adminApi.ts`，后台组件只消费类型化函数，不复刻 fetch 逻辑。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、原生 CSS；不引入新运行时依赖。

**Spec:** `docs/superpowers/specs/2026-10-18-admin-console-design.md`

## Global Constraints

- 不迁移到 Django、Vue 或 Element Plus。
- 仅使用已经存在的 FastAPI 接口，不创建虚假的用户、容器、CTF 或课程功能。
- `/`、`/replay/...` 和现有登录流程保持兼容。
- 删除、取消等高风险操作必须二次确认。

## Review Focus

- 未登录或 API 返回 401/403 时，后台必须展示权限提示而不是空状态。
- 运行中战局不能显示删除按钮；取消只对 pending/running 可用。
- 请求失败时保留 `X-Request-ID`，方便排障。
- 列表空数据和后端字段缺失不能导致页面崩溃。
- `/admin` 路径选择不能改变公开首页入口。

### Task 1: 管理后台 API 封装

**Files:**
- Create: `frontend/frontend-ui/src/adminApi.ts`
- Test: `frontend/frontend-ui/src/adminApi.test.ts`

定义后台所需的类型化查询和操作函数，复用 `api.ts` 的请求、鉴权和错误处理。

### Task 2: 管理后台页面

**Files:**
- Create: `frontend/frontend-ui/src/AdminApp.tsx`
- Create: `frontend/frontend-ui/src/AdminApp.css`
- Create: `frontend/frontend-ui/src/AdminApp.test.tsx`
- Modify: `frontend/frontend-ui/src/main.tsx`

实现战局、审计/事件、指标和外部案例四个真实模块，并按 `/admin` 路径加载。

### Task 3: 集成验证

**Files:**
- No production files unless verification finds a defect.

运行前端测试、lint、build，并核对公开 `App` 测试与管理员测试全部通过。
