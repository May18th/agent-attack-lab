# 管理后台 3D 工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有管理员操作的前提下，为 `/admin` 增加可降级的 Three.js 3D 态势、战局、审计时间线和外部案例视图。

**Architecture:** 保留 `AdminApp.tsx` 的数据加载和高危操作，将渲染拆成 `admin3d/` 下的场景模型、渲染器和 React 视图组件。Three.js 只在管理路由懒加载，2D 列表/详情仍是可访问的主操作面；3D 视图通过现有 `adminApi.ts` 数据适配，不改后端协议。

**Tech Stack:** React 19、TypeScript、Vite、Three.js 原生 API、Vitest、Testing Library。

**Spec:** `docs/superpowers/specs/2026-10-19-admin-3d-workbench-design.md`

## Global Constraints

- 只修改管理员后台，不重写公开前端业务页面。
- 不引入 Blender 或 Unreal Engine 运行时；专用资产仅允许后续以 glTF/GLB 静态资源接入。
- 3D 场景不得成为唯一操作入口；重试、取消、删除必须继续由 2D 控件和二次确认执行。
- 外部案例只显示为独立只读节点，不虚构案例与战局的关联。
- 不上传 `.env.local`、证书、数据库、`node_modules` 或长期记忆内容。
- 页面必须支持 WebGL 不可用、减少动效和移动窄屏降级。

## Review Focus

- WebGL 初始化失败：应显示现有 2D 工作台而不是白屏；由 Task 4 的降级测试覆盖。
- 管理接口返回空数据：应显示空状态且不创建幽灵节点；由 Task 2 的适配器测试覆盖。
- 选中战局后详情请求迟到：不能覆盖当前选择；由 Task 3 的竞态回归测试覆盖。
- 节点/边超过渲染上限：必须按活动状态与最近更新时间截断并显示提示；由 Task 1 的模型测试覆盖。
- `prefers-reduced-motion` 或用户暂停动效：渲染器不得继续驱动脉冲动画；由 Task 4 的渲染器测试覆盖。

### Task 1: 3D 数据模型与渲染核心

**Files:**
- Create: `frontend/frontend-ui/src/admin3d/sceneModel.ts`
- Create: `frontend/frontend-ui/src/admin3d/sceneModel.test.ts`
- Create: `frontend/frontend-ui/src/admin3d/ThreeScene.ts`
- Create: `frontend/frontend-ui/src/admin3d/ThreeScene.test.ts`
- Modify: `frontend/frontend-ui/package.json`
- Modify: `frontend/frontend-ui/package-lock.json`

**Interfaces:**
- Consumes: `AdminBattle`, `AdminMetrics`, `ExternalCase` 的现有类型和运行状态字段。
- Produces: `buildAdminSceneModel(input): AdminSceneModel`；`ThreeScene` 提供 `mount(container, model, options)`、`update(model)`、`setMotionPaused(paused)`、`resetCamera()`、`dispose()`。

- [ ] **Step 1: Write the failing model tests**

  在 `sceneModel.test.ts` 固定攻击/防守/调度节点、状态颜色、独立外部案例节点、空数据和 64 节点/128 边上限；断言截断优先活动状态和最近更新时间。

- [ ] **Step 2: Run model tests to verify failure**

  Run: `npm --prefix frontend/frontend-ui test -- sceneModel.test.ts`
  Expected: FAIL because `sceneModel.ts` does not exist.

- [ ] **Step 3: Implement `buildAdminSceneModel`**

  在 `sceneModel.ts` 定义明确的 TypeScript 类型和纯函数；不访问 DOM、不发请求、不生成外部案例关联边。

- [ ] **Step 4: Add Three.js and write renderer tests**

  安装 `three` 运行依赖及 TypeScript 类型，在 `ThreeScene.test.ts` 用最小 DOM 容器断言初始化、`update`、暂停动效、重置视角和 `dispose` 清理。

- [ ] **Step 5: Implement `ThreeScene`**

  使用 WebGLRenderer、PerspectiveCamera、OrbitControls 等 Three.js 原生模块；固定对象池和实例化几何体，提供节点选中回调、图例所需状态颜色，并在 WebGL 不可用时抛出可识别错误。

- [ ] **Step 6: Run Task 1 tests**

  Run: `npm --prefix frontend/frontend-ui test -- sceneModel.test.ts ThreeScene.test.ts`
  Expected: PASS。

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/frontend-ui/package.json frontend/frontend-ui/package-lock.json frontend/frontend-ui/src/admin3d
  git commit -m "feat: add admin 3d scene model and renderer"
  ```

### Task 2: 管理后台 3D 工作台布局与视图切换

**Files:**
- Create: `frontend/frontend-ui/src/admin3d/Admin3DWorkspace.tsx`
- Create: `frontend/frontend-ui/src/admin3d/Admin3DWorkspace.css`
- Create: `frontend/frontend-ui/src/admin3d/Admin3DWorkspace.test.tsx`
- Modify: `frontend/frontend-ui/src/AdminApp.tsx`
- Modify: `frontend/frontend-ui/src/AdminApp.css`

**Interfaces:**
- Consumes: Task 1 的 `AdminSceneModel` 和 `ThreeScene`；现有 `overviewItems`、`metrics`、`battles`、`cases`、`selected`、`detailData`。
- Produces: `Admin3DWorkspace` props `{ metrics, battles, cases, selectedBattle, detailData, onSelectBattle }`；向上报告节点选择，不执行破坏性动作。

- [ ] **Step 1: Write the failing workspace tests**

  在 `Admin3DWorkspace.test.tsx` 断言默认显示 3D 场景、导航标签切换、节点选择调用 `onSelectBattle`、外部案例显示为独立节点、暂停/重置/切换 2D 控件存在。

- [ ] **Step 2: Run workspace tests to verify failure**

  Run: `npm --prefix frontend/frontend-ui test -- Admin3DWorkspace.test.tsx`
  Expected: FAIL because the component is not defined.

- [ ] **Step 3: Implement `Admin3DWorkspace`**

  使用 `useRef` 管理 Three.js 生命周期，使用 `ResizeObserver` 保持画布尺寸；将四个视图作为 `/admin` 内标签状态，不新增后端路由。相机和筛选只保留在当前 React 会话。

- [ ] **Step 4: Integrate with `AdminApp.tsx`**

  将 3D 工作台放在运行指标和战局列表之前，保留所有现有 2D 模块、加载状态、错误提示和高危操作；选择 3D 战局节点时复用 `selectBattle`。

- [ ] **Step 5: Add responsive styles**

  在 `Admin3DWorkspace.css` 与 `AdminApp.css` 中为桌面、平板和窄屏设置稳定高度、无重叠布局和文本溢出处理；不改公开页面样式。

- [ ] **Step 6: Run Task 2 tests**

  Run: `npm --prefix frontend/frontend-ui test -- Admin3DWorkspace.test.tsx AdminApp.test.tsx`
  Expected: PASS。

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/frontend-ui/src/admin3d/Admin3DWorkspace.tsx frontend/frontend-ui/src/admin3d/Admin3DWorkspace.css frontend/frontend-ui/src/admin3d/Admin3DWorkspace.test.tsx frontend/frontend-ui/src/AdminApp.tsx frontend/frontend-ui/src/AdminApp.css
  git commit -m "feat: add admin 3d workspace"
  ```

### Task 3: 战局详情、审计时间线与数据刷新

**Files:**
- Create: `frontend/frontend-ui/src/admin3d/BattleTimeline3D.tsx`
- Create: `frontend/frontend-ui/src/admin3d/BattleTimeline3D.test.tsx`
- Modify: `frontend/frontend-ui/src/AdminApp.tsx`
- Modify: `frontend/frontend-ui/src/adminApi.ts` (only if a typed adapter is needed for existing endpoints)

**Interfaces:**
- Consumes: `selected`、`detailData`、现有战局事件/审计/评分/报告请求结果。
- Produces: `BattleTimeline3D` props `{ battle, events, audit, onSelectEvent }`；不新增后端接口。

- [ ] **Step 1: Write failing timeline tests**

  断言事件按 `sequence` 排序、选中事件可回传、空事件显示空状态、详情选择切换后迟到的旧请求不会覆盖当前战局。

- [ ] **Step 2: Run timeline tests to verify failure**

  Run: `npm --prefix frontend/frontend-ui test -- BattleTimeline3D.test.tsx AdminApp.test.tsx`
  Expected: FAIL because the timeline component and integration are absent.

- [ ] **Step 3: Implement timeline component**

  以当前战局为中心绘制事件轨迹和审计层级；敏感字段直接显示后端返回的脱敏内容；3D 交互仅选择事件，不触发管理动作。

- [ ] **Step 4: Integrate existing detail loading**

  在 `AdminApp.tsx` 中复用现有请求和竞态保护；只对页面可见且状态为 `pending/running` 的战局按 15 秒轮询，页面隐藏时暂停，恢复时立即刷新一次。

- [ ] **Step 5: Run Task 3 tests**

  Run: `npm --prefix frontend/frontend-ui test -- BattleTimeline3D.test.tsx AdminApp.test.tsx`
  Expected: PASS。

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/frontend-ui/src/admin3d/BattleTimeline3D.tsx frontend/frontend-ui/src/admin3d/BattleTimeline3D.test.tsx frontend/frontend-ui/src/AdminApp.tsx frontend/frontend-ui/src/adminApi.ts
  git commit -m "feat: add 3d battle timeline and refresh handling"
  ```

### Task 4: 降级、可访问性与生产验收

**Files:**
- Create: `frontend/frontend-ui/src/admin3d/performanceMode.ts`
- Create: `frontend/frontend-ui/src/admin3d/performanceMode.test.ts`
- Modify: `frontend/frontend-ui/src/admin3d/Admin3DWorkspace.tsx`
- Modify: `frontend/frontend-ui/src/admin3d/ThreeScene.ts`
- Modify: `frontend/frontend-ui/src/AdminApp.test.tsx`
- Modify: `frontend/frontend-ui/README.md`

**Interfaces:**
- Consumes: `window.matchMedia`, WebGL capability检测、用户暂停状态和现有 2D 工作台。
- Produces: `resolveAdmin3DMode(input): 'full' | 'lite' | '2d'`；`Admin3DWorkspace` 在 `2d` 模式隐藏 WebGL 但保留相同导航、筛选和操作。

- [ ] **Step 1: Write failing performance mode tests**

  覆盖 WebGL 不可用、`prefers-reduced-motion`、窄屏和用户手动 2D 切换；断言不因阈值判断丢失管理功能。

- [ ] **Step 2: Run tests to verify failure**

  Run: `npm --prefix frontend/frontend-ui test -- performanceMode.test.ts`
  Expected: FAIL because mode resolver is absent.

- [ ] **Step 3: Implement mode resolver and fallback**

  默认桌面为 `full`，窄屏或低性能条件为 `lite`，WebGL 不可用/用户切换为 `2d`；将选择保存于当前 React 会话，不写入敏感持久化存储。

- [ ] **Step 4: Add accessibility and error states**

  为画布提供文本图例、`aria-label`、键盘可达按钮、错误/空状态和鉴权失败提示；单个指标接口失败时保留其他层并标记数据过期，不让整页白屏。

- [ ] **Step 5: Run full frontend verification**

  Run: `npm --prefix frontend/frontend-ui test`
  Expected: all tests PASS。

  Run: `npm --prefix frontend/frontend-ui run build`
  Expected: TypeScript、Vite production build PASS。

  Run: `npm --prefix frontend/frontend-ui run lint`
  Expected: no lint errors or warnings。

- [ ] **Step 6: Browser visual verification**

  在桌面和移动视口打开 `/admin`，确认 3D 画布非空、节点可选、无文本重叠、2D 降级可用、重置/暂停控件有效。

- [ ] **Step 7: Update documentation and commit**

  在 `README.md` 记录 Three.js 依赖、3D/2D 降级开关、测试和启动命令；提交全部 Task 4 文件。

  ```bash
  git add frontend/frontend-ui/src/admin3d frontend/frontend-ui/src/AdminApp.test.tsx frontend/frontend-ui/README.md
  git commit -m "test: verify admin 3d fallback and accessibility"
  ```

## Self-Review

- Spec coverage: 3D 拓扑、战局选择、审计时间线、外部案例、降级、性能上限、鉴权局部错误和现有操作均由 Task 1-4 覆盖。
- Type consistency: `AdminSceneModel` 与 `ThreeScene` 在 Task 1 输出，Task 2 消费；Task 3 只消费现有详情数据；Task 4 负责模式解析和统一降级。
- Review focus: 五项高风险输入均在对应任务中有明确测试。
- Proportion: 计划只固定文件、接口、阈值和测试，不预写实现细节。
