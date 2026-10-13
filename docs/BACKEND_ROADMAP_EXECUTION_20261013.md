# 后端路线图执行记录（2026-10-13）

## 本次已完成

- 战局取消：新增 `POST /battles/{battle_id}/cancel`，运行中的后台战局进入 `cancelled`，并写入 `battle.cancelled` 终态事件。SSE/WebSocket 将该事件视为终态。
- 外部案例来源清单：新增 `GET /external-cases/sources`，只读返回发布者、来源 URL、目录版本、发布时间、抓取时间、内容 SHA-256 和导入条数；不暴露原始 JSON，也不提供任意 URL 抓取。
- ACP 调用审计：新增 `GET /acp/calls/{call_id}/audit`，按 `correlationId` 返回开始/完成/失败事件的结构化脱敏字段；样本、请求、响应、凭据和证书字段不会通过该接口返回。
- 规则版本目录：新增 `/rules`、`/rules/{id}`、`/rules/{id}/versions`、`/rules/{id}/rollback` 和 `/rules/{id}/test`。规则目录是数据型、版本化的审核对象，不会将导入字段当作 Python、Shell 或命令执行。

## 验证结果

```text
119 passed, 4 skipped
```

跳过项是 Windows 环境缺少 Bash 的既有检查；保留既有 Starlette/httpx 弃用警告。

## 尚未执行的高影响事项

- 用户、团队、角色、API Key 归属和限流：当前浏览器会话/API Key 模型尚无多用户数据隔离，不能直接迁移生产数据库。
- 外部来源自动抓取：继续通过受控脚本导入一手来源；平台端点不接受任意 URL，避免 SSRF、伪造来源和未经审核的数据入库。
- 动态规则接入执行链：当前规则目录只做版本与结构校验，需另行设计审核、灰度、回滚和执行沙箱。
- 生产部署：本提交只完成本地代码与测试，须经审核后在隔离环境验证取消、规则目录、审计接口，再安排 VPS 发布；不上传 `.env`、证书、私钥、数据库或外部案例数据库。

## 兼容性

- 现有战局、SSE、WebSocket、战报、评分和 OpenAPI 路由保持不变。
- `cancelled` 是新增终态；删除接口仍只允许删除 `completed`、`failed` 或 `cancelled` 战局。
- 外部案例仍与战局数据库隔离，外部事实不会自动变成项目观测事件。
