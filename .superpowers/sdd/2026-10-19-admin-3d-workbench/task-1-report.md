# Task 1 实施报告：3D 数据模型与渲染核心

## 文件变更

- `frontend/frontend-ui/src/admin3d/sceneModel.ts`：新增纯函数 `buildAdminSceneModel`、模型类型、状态色、固定攻防/调度节点、战局与外部案例节点及无案例关联边的关系模型；节点上限 64、边上限 128，战局截断按活动状态优先、创建时间新到旧排序，案例按 `dateAdded` 新到旧截断。
- `frontend/frontend-ui/src/admin3d/sceneModel.test.ts`：覆盖固定节点/颜色、独立案例节点、空数据、容量上限及活动/创建时间优先级和案例日期优先级。
- `frontend/frontend-ui/src/admin3d/ThreeScene.ts`：新增原生 Three.js WebGL 渲染器封装，包含实例化节点/关系网格、选择回调、相机控制、暂停、重置、尺寸更新及资源/监听器释放；WebGL 初始化失败抛出 `WEBGL_UNAVAILABLE` 可识别错误。
- `frontend/frontend-ui/src/admin3d/ThreeScene.test.ts`：覆盖挂载、更新、暂停、重置、销毁和 WebGL 不可用错误。
- `frontend/frontend-ui/package.json`、`frontend/frontend-ui/package-lock.json`：增加 Three.js 运行依赖及类型依赖。

## 测试与验证

- RED：`npm --prefix frontend/frontend-ui test -- sceneModel.test.ts ThreeScene.test.ts`，失败原因符合预期，两个新测试文件无法解析尚不存在的 `sceneModel` 模块。
- 定向：`npx vitest run src/admin3d/sceneModel.test.ts src/admin3d/ThreeScene.test.ts`，通过，2 个文件、5 个测试。
- TypeScript：`npx tsc -p tsconfig.app.json --noEmit`，通过，无输出。
- 全量：`npm test`，通过，Vitest 6 个文件/51 个测试；Node 4 个测试通过。
- Lint：`npm run lint`，通过，无告警。
- 生产构建：`npm run build`，通过，Vite 构建成功。

## 提交

- Commit：`f13cf902e0f1106e7820bd7250ba2f606f3a4996`
- Message：`feat: add admin 3d scene model and renderer`

## 关注事项

- jsdom 不提供 Canvas `getContext`，WebGL 不可用测试会在 stderr 输出 jsdom 的 `getContext` 提示；测试断言了明确的 `WEBGL_UNAVAILABLE` 错误。真实浏览器 WebGL 可用性仍应在集成页面中验证。
- `npm install` 提示本地环境的 `esbuild`、`workerd` install scripts 尚未获准；本任务未运行或批准这些安装脚本。当前 TypeScript、lint、测试和生产构建均已通过。
- 工作区中已有的 `.superpowers/`、计划/规格文档及根 `node_modules/` 未纳入本任务提交。

## Round 1 修复

- 修复：案例节点截断前按 `dateAdded` 降序排序；战局仍仅按活动状态和其现有 `createdAt` 排序。模型统一时间字段更名为 `timestamp`，不再将战局创建时间称为更新时间。
- RED 命令：`npx vitest run src/admin3d/sceneModel.test.ts`
- RED 输出：`1 failed`，`keeps the newest external cases when shuffled input exceeds node capacity` 断言 `case:CVE-69` 未保留，确认修复前的输入顺序截断缺陷。
- 验证命令：`npx vitest run src/admin3d/sceneModel.test.ts src/admin3d/ThreeScene.test.ts; npx tsc -p tsconfig.app.json --noEmit`
- 验证输出：Vitest `Test Files 2 passed (2)`、`Tests 6 passed (6)`；TypeScript 检查退出码为 0 且无输出。
- 修复提交：待提交。
