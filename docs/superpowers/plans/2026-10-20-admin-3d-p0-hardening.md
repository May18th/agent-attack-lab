# 管理后台 3D P0 加固实施计划

> **目标：** 在不改变现有 3D 交互和登录/管理接口的前提下，拆分超大场景类、将分层拦截统计迁移为后端事件数据，并补齐结构化节点详情。

## 范围与事实边界

- 保持现有 React + TypeScript + Three.js 技术栈和视觉行为。
- `defense.completed.data.layerInterceptions` 由后端根据真实 `round.completed` 防守结果推导；它不是设备遥测，事件同时携带推导依据标识。
- 前端优先消费后端统计；历史事件没有该字段时显示“未记录”，不再按难度模拟。
- 节点详情面板已经存在，本次只补齐屏障统计、OWASP 分类和内网穿透/响应状态。
- 不改数据库表，不新增外部服务，不改认证接口。

## 文件职责

- `backend/src/agent_attack_lab/layer_interceptions.py`：把真实轮次防守结果归类为四层统计。
- `backend/src/agent_attack_lab/service.py`：在同步和后台战局的 `defense.completed` 事件写入统计。
- `backend/tests/`：验证统计守恒、事件契约和无数据边界。
- `frontend/frontend-ui/src/admin3d/BarrierRenderer.ts`：屏障创建、主题、脉冲和统计标签。
- `frontend/frontend-ui/src/admin3d/PacketPlayer.ts`：攻击粒子创建、路径状态和播放。
- `frontend/frontend-ui/src/admin3d/NetworkLayout.ts`：主链路/节点布局与路径计算。
- `frontend/frontend-ui/src/admin3d/SceneEvents.ts`：事件提示、事件目标与状态映射。
- `frontend/frontend-ui/src/admin3d/ThreeScene.ts`：只保留场景编排、生命周期、相机和选择协调。
- `frontend/frontend-ui/src/admin3d/NodeDetailsPanel.tsx`：结构化节点详情展示。

## 任务 1：后端真实结果推导统计

1. 先写失败测试：各层 `blocked/passed` 守恒，未命中轮次通过全部层，命中轮次只在一个归类层阻断。
2. 实现纯函数，从 topic 和每轮实际 `caught/risks` 推导统计，并返回 `basis=derived_from_defense_results`。
3. 先写事件契约失败测试，再在同步和后台战局的 `defense.completed` 写入 `layerInterceptions`。
4. 运行后端目标测试及完整可用测试集。

## 任务 2：拆分 ThreeScene

1. 用现有测试锁定公开行为；新增模块级失败测试，确认屏障、粒子、布局、事件逻辑可独立调用。
2. 逐个提取 `NetworkLayout`、`SceneEvents`、`BarrierRenderer`、`PacketPlayer`，每次提取后运行相关测试。
3. `ThreeScene` 通过组合模块保持原公开 API，不改变调用方。
4. 运行 ThreeScene、场景模型、工作台测试和 TypeScript 检查。

## 任务 3：详情面板消费后端统计

1. 先写失败测试：屏障显示后端统计与依据；历史事件显示未记录；内网显示穿透与防守响应状态。
2. 更新场景节点数据关联和详情面板，移除“前端模拟估算”文案。
3. 运行详情面板和工作台测试。

## 任务 4：整体验收与发布前检查

1. 运行前端全量测试、lint、TypeScript、生产构建。
2. 运行后端测试；若本机缺依赖，明确列出未验证项。
3. 检查敏感信息、Git 差异和构建产物，确认 DeepSeek 密钥未进入前端或仓库。
4. 代码审查通过后，再单独执行云端部署和线上冒烟验证。
