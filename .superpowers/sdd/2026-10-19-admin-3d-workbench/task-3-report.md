# Task 3 报告：战局详情、审计时间线与数据刷新

## 结果

- 新增 `BattleTimeline3D`，展示当前选中战局、按 `sequence` 排序的事件轨迹和审计层级。
- 事件选择只更新所选事件并通过 `onSelectEvent` 回传，不触发重试、取消、删除等管理动作。
- 复用 AdminApp 已有的详情、事件、审计、评分和报告请求；未新增后端接口或修改 `adminApi`、Task 2 工作台 props。
- 保留 `detailRequestId` 竞态保护。迟到的旧战局详情不能覆盖当前选中战局。
- 仅在页面可见且当前战局状态为 `pending` 或 `running` 时，每 15 秒刷新详情；隐藏时清除定时器，恢复可见时立即刷新一次。详情接口返回终态后停止轮询。

## 变更文件

- `frontend/frontend-ui/src/admin3d/BattleTimeline3D.tsx`
- `frontend/frontend-ui/src/admin3d/BattleTimeline3D.css`
- `frontend/frontend-ui/src/admin3d/BattleTimeline3D.test.tsx`
- `frontend/frontend-ui/src/AdminApp.tsx`
- `frontend/frontend-ui/src/AdminApp.test.tsx`

## 验证

- `npm test`：通过，8 个 Vitest 文件共 62 项通过；build-environment Node 测试 4 项通过。
- `npm run lint`：通过，无 lint 告警。
- `npm run build`：通过。
- 针对 Task 3 的 `BattleTimeline3D.test.tsx` 与 `AdminApp.test.tsx`：15 项通过，覆盖事件排序、选择回传、空状态、旧请求竞态，以及可见刷新、隐藏暂停和恢复刷新。

## 提交

- 实现提交：`877c8ca` (`feat: add 3d battle timeline and refresh handling`)
- 本次实现提交仅包含上述 5 个源代码与测试文件。

## 关注项

- 构建成功，但 Vite 提示 Admin3DWorkspace 代码块压缩后约 565 KB，超过 500 KB 提示阈值；本任务没有调整 Task 2 的分块策略。
- Vitest 的 jsdom 环境输出 `HTMLCanvasElement.getContext()` 未实现提示；现有 3D 场景在测试中回退为 WebGL 不可用占位状态，相关测试仍通过。
- 页面展示的数据直接使用现有后端响应；敏感字段脱敏依赖现有后端返回内容，本任务未另行变换字段。
