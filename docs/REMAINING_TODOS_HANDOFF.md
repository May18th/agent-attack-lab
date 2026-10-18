# 当前未完成事项

更新时间：2026-10-18

历史待办已经完成或失效，不再保留旧的未勾选清单。项目实时状态以
[`CURRENT_STATUS.md`](CURRENT_STATUS.md) 和当前 GitHub Pull Request 检查结果为准。

## 当前有效事项

1. 由 Cloudflare 账户维护者确认或修复账户 `434bfd...` 下重复的 Workers Builds
   集成。不得修改另一个已经通过检查的 Workers Preview 配置。

该事项是外部账户配置核对项；当前仓库代码、PR 检查和生产部署均不因此阻塞。

## 近期已核实完成

- PR #4 已于 2026-10-12 合并，隔离 Preview 的前端构建、后端测试、Pages 和
  Workers Builds 检查均成功；不再重复验收或保留为合并前置条件。
- PR #31 的本地隔离业务验收记录已于 2026-10-18 合并到 `main`（合并提交
  `18a7544`）。

## 已完成且不再列为待办

- 正式前端根域名和 `www` 的 HTTPS 访问。
- 正式 API、Tunnel、生产 CORS 和公开/管理路由鉴权边界。
- 前端 FE-01 至 FE-16、测试、Lint 和生产构建。
- `low`、`mid`、`high` 生产与隔离 Preview API 验收。
- 空白主题 `422`、合法创建 `201`、已结束战局删除 `204` 和运行中删除 `409`
  的契约验证。

## 安全边界

- Preview 不得连接生产数据库或生产写接口。
- 不提交 `.env`、API Key、Tunnel Token、EAB、证书/私钥、数据库、日志、
  JSONL 或私有发行文件。
- 不重复创建 Pages 自定义域名绑定，不绕过审核直接合并。
