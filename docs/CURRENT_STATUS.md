# 当前项目状态

更新时间：2026-10-11

本文只记录当前状态；历史执行证据见 [`TEAM_HANDOFF.md`](TEAM_HANDOFF.md) 与 Git 历史。

## 代码与发布

- PR #2 已于 2026-10-11 合并，合并提交 `ae959fb`，PR head 为 `47d5916`；后端、前端、Cloudflare Pages、Workers Builds 四项检查均成功。
- 当前本地协作分支 `codex/team-domain-handoff` 指向 `47d5916`，与对应 origin 分支同步。
- 前端正式域名 `https://yuanyiagentzhandui.cn` 与 `https://www.yuanyiagentzhandui.cn` 本轮只读请求均返回 200，首页引用 bundle `index-BzFvd3kT.js`。检查该 bundle 未发现密码表单、`/auth/session` 调用或管理员登录文案；公开前端不设浏览器密码。
- API 正式地址 `https://api.yuanyiagentzhandui.cn`：本轮 `/health`、`/dashboard/summary`、`/battles?limit=1`、`/external-cases?limit=1` 均返回 200；OpenAPI 包含 `DELETE /battles/{battle_id}`。
- 后台 `/dashboard` 和战局回放接口未登录均返回 401，后台鉴权仍保留。此次未对生产发送创建、更新或删除请求。

## 生产边界与后续

- 生产代码部署记录指向 `47d5916`；本轮通过公网只读探测确认服务可响应及删除路由已公开，不代表已在生产执行全部写接口验收。
- Partner mTLS、Discovery 及此前 low/mid/high 全链路结论沿用 `TEAM_HANDOFF.md` 的历史验收记录；本轮没有重新验证证书正向调用、Registry/Discovery 或生产战局。
- 不配置外部 LLM，Agent 继续规则兜底，等待负责人批准端点和凭据。
- 每小时巡检是否由外部调度器运行仍无法确认；不停止无关任务。
- 下一步由负责人安排安全环境的写接口验收：空白 topic=422、合法创建=201、已完成战局删除=204并清理事件、运行中战局删除=409；不拿生产数据做破坏性测试。

## 数据与安全

- CISA KEV 本机快照版本为 `2026.10.08`，1,739 条；先前只读对比官方源新增/删除/变更均为 0，SHA-256 为 `fb1621beec7db19d99c1f919dede3d4cc01ad88acd16f79f1592929c4826dfee`。
- 外部案例仅作注明来源的事实参考，不伪装成项目战局；战局审计只读。
- `battle-694dce7f` 曾在已检查的本机及 VPS 默认数据库中均未找到，不凭旧回执删除其他记录。
- 本机有未跟踪队友材料和发行 wheel，均保持原样、不纳入 Git。长期记忆、`.env`、Token、EAB、证书/私钥、数据库、日志、私有 wheel、JSONL 和机器本地配置禁止提交。
