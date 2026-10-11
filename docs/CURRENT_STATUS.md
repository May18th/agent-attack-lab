# 当前项目状态

更新时间：2026-10-11

本文只记录当前事实；过往执行细节保留在 [`TEAM_HANDOFF.md`](TEAM_HANDOFF.md) 与 Git 历史中。

## 当前代码

- 协作分支：`codex/team-domain-handoff`，当前提交 `03c935c`；与对应远端分支同步。
- PR #2 指向 `main`，状态 OPEN、mergeable state CLEAN；GitHub 后端、前端、Cloudflare Pages、Workers Builds 四项检查均成功，当前无 review。
- 当前代码已包含空白 topic 校验、战局删除接口、外部案例只读查询、战局完整性审计、目录差异报告和 Git 敏感文件防护。
- 本机验证：后端 `96 passed, 4 skipped`；前端 `19 passed`；lint、build、敏感文件检查通过。

## 生产边界

- 2026-10-11 的已有生产验收记录显示：攻击/防守 nginx 443 按路径强制 mTLS，`/health` 免证书、`/rpc` 无证书拒绝；Leader 通过有效 clientAuth 证书调用两个 Partner，low/mid/high 战局均完成。详见 `TEAM_HANDOFF.md` 的“生产 Partner mTLS 已完成”。本次整理没有重新操作或复测 VPS、Cloudflare、Registry。
- 生产部署版本仍需队友按审核流程确认。既有记录曾显示 VPS OpenAPI 缺少 DELETE 战局路由；本分支现有实现不能据此视为已部署。
- 外部 LLM 按负责人决定暂不配置；当前 Agent 继续规则兜底。
- 负责人已要求停用每小时巡检，但本机任务计划及 VPS 可见的 systemd timer/crontab 均未找到对应任务；外部调度器状态无法确认，不停止其他任务。

## 数据与安全

- CISA KEV 当前来源仍为目录版本 `2026.10.08`、1,739 条；本机只读对比官方源，新增/删除/变更均为 0，SHA-256 为 `fb1621beec7db19d99c1f919dede3d4cc01ad88acd16f79f1592929c4826dfee`。
- 外部案例仅作为注明来源的事实参考，不伪装成项目战局；战局审计只读，不修复或删除记录。
- `battle-694dce7f` 曾在本机和 VPS 默认数据库中均未找到，不凭旧回执删除其他战局。
- 本机仍有未跟踪的队友材料和发行 wheel；均保持原样且不纳入 Git。长期记忆、`.env`、Token、EAB、证书/私钥、数据库、日志、私有 wheel、JSONL 和机器本地配置禁止提交。

## 下一步

1. 等待队友正常审核并合并 PR #2；不绕过 review、不自行部署。
2. 合并后由生产负责人更新 VPS，再按接口契约验证空 topic 为 422、合法创建为 201、已结束战局删除为 204 并清理事件、运行中删除为 409，同时回归公网 mTLS 和 Discovery。
3. 仅在负责人另行批准模型端点和凭据后配置外部 LLM。
