# 当前未完成事项

更新时间：2026-10-12

历史待办已经完成或失效，不再保留旧的未勾选清单。项目实时状态以
[`CURRENT_STATUS.md`](CURRENT_STATUS.md) 和当前 GitHub Pull Request 检查结果为准。

## 当前有效事项

1. 在桌面浏览器验收 PR #4 的隔离 Preview：页面正常渲染、控制台无阻塞错误，
   `low`、`mid`、`high` 请求只发送到 `https://preview-api.yuanyiagentzhandui.cn`。
2. 由 Cloudflare 账户维护者修复或移除账户 `434bfd...` 下重复的 Workers Builds
   集成。不得修改另一个已经通过检查的 Workers Preview 配置。
3. 上述两项完成且 PR 检查全部通过后，按正常审核流程批准并合并 PR #4。

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
