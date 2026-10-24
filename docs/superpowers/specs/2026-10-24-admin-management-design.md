# 管理员后台功能补全设计

## 目标

为现有管理员 3D 工作台补齐战局创建、攻击样本管理、防守规则管理、审计日志查看和战局导出，沿用管理员密码会话和现有 React + FastAPI 技术栈。

## 范围

- 创建战局：主题与难度表单，提交现有 `POST /battles?background=true` 并自动选中新战局。
- 样本库：展示可持久化样本，支持新增、编辑、删除和使用次数。
- 规则库：展示可持久化规则，支持新增、编辑、删除和命中次数。
- 审计日志：按时间、用户、操作类型筛选，展示时间、用户、操作和详情。
- 数据导出：战局 CSV 下载（Excel 可直接打开）和浏览器打印为 PDF。

## 约束

- 不引入 OpenAI 或新的第三方服务；不改变现有认证接口。
- 继续使用管理员密码会话，管理接口全部复用 `_check_browser_or_api_auth`。
- 样本内容按现有事件数据限制长度，审计数据继续经过敏感字段清洗。
- 未记录的评分显示“评分不足”，不生成模拟评分。

## 数据契约

- `GET/POST/PATCH/DELETE /admin/samples`
- `GET/POST/PATCH/DELETE /admin/rules`
- `GET /admin/audit-logs`
- `POST /battles?background=true` 保持原请求体 `{topic,difficulty}`。

样本字段：`id, topic, content, source, useCount, createdAt, updatedAt`。
规则字段：`id, name, condition, action, hitCount, createdAt, updatedAt`。
审计字段沿用现有 `audit_events`：`createdAt, actorRole, eventType, status, data`。

## 页面结构

管理员工作台顶部增加模块导航：3D 工作台、样本库、规则库、审计日志。战局列表旁增加“创建战局”和“导出 CSV/打印 PDF”。页面使用现有深色控制台视觉，不改变 3D 节点位置与交互。
