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

## Review 修复（2026-10-19）

- 修复提交：`d50d67a` (`fix: render selectable 3d battle timeline`)
- 根因：初版时间线只渲染 HTML 列表，没有实际 Three.js 轨迹；所选事件的组件状态也没有随战局 ID 切换清空。
- 新增 `buildBattleTimelineSceneModel`：按 sequence 排序事件节点，并以相邻事件边组成轨迹。该模型只接收当前 battle 和其 events，不包含 external-case 节点或案例连线。
- `BattleTimeline3D` 复用 `ThreeScene` 的 InstancedMesh 与 Raycaster；点击 3D 事件节点会将源事件交给 `onSelectEvent`。有序 HTML 事件列表仍保留为键盘可操作的文本 companion/fallback。
- renderer 通过动态导入加载，避免将 Three.js 静态并入首屏主包；切换战局时以 battle ID keyed 子组件重建，清空旧事件选择。
- RED 证据：新增用例在实现前因 battle 切换后 `aria-pressed` 仍为 `true`、且事件 3D 模型构建器缺失而失败。
- GREEN 验证：`BattleTimeline3D.test.tsx`、`AdminApp.test.tsx`、`sceneModel.test.ts`、`ThreeScene.test.ts`、`Admin3DWorkspace.test.tsx` 共 5 个文件、30 项通过。
- 全量 `npm test`：8 个 Vitest 文件 66 项通过，build-environment Node 测试 4 项通过。
- `npm run lint`、`npx tsc -b`：通过。
- `npm run build`：通过；主 bundle 约 260 KB，Three.js renderer 留在约 557 KB 的动态 chunk，仍有 Vite 的 500 KB chunk 提示。
- jsdom 继续输出不支持 `HTMLCanvasElement.getContext()` 的提示；Three.js 事件节点真实拾取由 rendererFactory 测试验证，组件在无 WebGL 环境仍提供可操作的 HTML companion。

## Review 修复（2026-10-19，round 2）

- 修复提交：`a81bb23` (`fix: mount 3d timeline with latest model`)
- 根因：`ThreeScene` 动态导入尚未完成时，父组件可能已收到新事件并更新 scene model；旧实现只捕获初次渲染模型，renderer 迟到 mount 时仍使用空模型。
- 修复：通过 `sceneModelRef` 在模型提交时同步最新模型，动态导入完成后读取该 ref；新增 `timelineSceneLoader.ts` 作为受控异步导入边界。
- 回归测试覆盖“导入未完成期间事件更新，renderer mount 必须使用新事件模型”。测试首次执行时发现测试自身在 rerender 更换了 `onSelectEvent` identity，触发 effect cleanup 并取消 pending import；统一两次渲染的 callback 后测试通过。该测试 harness 问题不作为产品缺陷的 RED 证据。
- `BattleTimeline3D.test.tsx`：6 项通过；相关 5 个测试文件（`BattleTimeline3D`、`AdminApp`、`sceneModel`、`ThreeScene`、`Admin3DWorkspace`）：31 项通过。
- 全量 `npm test`：8 个 Vitest 文件、67 项通过；build-environment Node 测试 4 项通过。
- `npm run lint`、`npx tsc -b`：通过。
- `npm run build`：通过；主 bundle 约 260 KB，Three.js 动态 chunk 约 557 KB，仍有 Vite 的 500 KB chunk 提示。
- Vitest 的 jsdom 仍打印 `HTMLCanvasElement.getContext()` 未实现提示；测试通过。
