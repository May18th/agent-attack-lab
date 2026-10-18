# 后端生产可靠性设计

## 目标

在现有 FastAPI 战局服务上补齐生产可靠性能力，不迁移到 Django，不引入课程系统、不改前端、不接入外部 LLM/API。

## 已有能力

- `X-Request-ID`、健康检查、基础请求指标。
- `pending/running/completed/failed` 战局状态、事件流、重试和进程重启恢复。
- `battle_scores`、Redis 缓存、ACP/mTLS/Partner RPC。

## 本次范围

1. 持久化审计事件，并关联 `request_id`、`battle_id`、ACP `correlation_id`。
2. `Idempotency-Key` 防止重复创建后台战局。
3. 战局执行超时、取消接口和超时状态收敛。
4. ACP 临时故障的有限重试、指数退避和运行指标。
5. 扩展 `/metrics`，暴露审计、超时、取消、ACP 重试等计数。

## 非目标

- 不实现 Django 重写、用户/团队/课程/CTF/容器管理。
- 不改变公开战局响应结构和现有评分规则。
- 不记录 API Key、Token、私钥或原始敏感 payload。
- 不把测试数据或本地数据库上传到 Git/生产。

## 数据设计

新增 `audit_events` 表：

`id`、`event_type`、`request_id`、`battle_id`、`correlation_id`、`actor_role`、`status`、`created_at`、`data`。

`request_id`、`battle_id`、`correlation_id` 允许为空；`data` 只保存脱敏结构化信息。SQLite、PostgreSQL、MySQL 初始化路径和 Alembic 迁移保持一致。

新增 `battle_idempotency` 表保存幂等键、请求指纹、战局 ID 和创建时间，避免进程重启或多请求时重复创建后台战局。

## 验收标准

- 相同 `Idempotency-Key` 和相同请求返回同一个后台战局；参数冲突返回 `409`。
- 超过配置时限的战局最终为 `failed`，并产生 `battle.timeout` 审计/事件。
- 取消 `pending/running` 战局返回 `202`，终态后重复取消返回 `409`。
- ACP 瞬时失败按配置次数重试，最终错误仍返回脱敏结果；重试次数可在 metrics 查询。
- 审计可按 `battle_id` 查询，任何记录不含密钥、证书私钥和原始敏感输入。
- 全量现有测试和新增测试通过。
