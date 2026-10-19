# 后端可靠性配置

当前后端沿用 FastAPI、现有数据库适配和 Redis，不引入 Django 或课程系统。

## 异步战局

- `Idempotency-Key`：后台创建战局时可选。相同键和相同参数返回同一个战局；相同键但参数不同返回 `409`。
- `POST /battles/{battle_id}/cancel`：取消 `pending` 或 `running` 战局；终态战局返回 `409`。
- `AGENT_BATTLE_TIMEOUT_SECONDS`：异步战局最大执行时间，默认 `300` 秒。

## ACP 重试

`AGENT_RPC_RETRIES` 默认值为 `2`，只重试超时、连接错误、远端协议错误和 HTTP 5xx；认证失败、参数错误和业务失败不重试。退避从 `0.1` 秒开始，封顶 `0.5` 秒。

## 审计与指标

`GET /battles/{battle_id}/audit` 附带脱敏的跨请求审计事件，`GET /metrics` 增加：

- `auditEvents`
- `battleTimeouts`
- `battleCancellations`
- `acpRetries`
- `acpTimeouts`

审计不会保存 API Key、Token、密码、证书或私钥。数据库迁移版本为 `20261018_0003`。
