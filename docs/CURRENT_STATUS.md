# 当前项目状态

更新时间：2026-10-10

本文是当前状态的短版事实源；历史细节保留在 `TEAM_HANDOFF.md`、审计报告和 Git 提交记录中。

## 已验证

- 当前协作分支：`codex/team-domain-handoff`；本轮整理前基线提交为 `eeeaa86`。
- 队友远端：`origin/main` 最新 `6d713fb`；双方已分叉，未直接合并或重置。
- 在独立临时 worktree 检查 `origin/main`：针对性 ACP 测试 `10 passed`，完整后端测试 `61 passed`。
- 本分支补充旧/新 SDK 构造参数兼容和 Partner 独立身份绑定后，本机官方 SDK 2.2 环境和全新公开 SDK 2.1 环境均为 `70 passed`，仅有既有 Starlette/httpx 弃用警告。
- 微调数据：原始 105 条，保守清洗保留 72 条、剔除 33 条；清洗集未上传 Git、VPS 或训练平台。条件、数量和校验见 `FINETUNE_CLEANING_20261010.md`。

## 当前阻塞

- GitHub Actions 曾因 SDK 版本兼容路径失败；本次已加入签名过滤和旧 SDK HTTP 客户端替换，需提交后由 CI 复验。
- 生产梧桐发行包 `release-manifest.json`、稳定 Agent `/rpc` 地址和真实端到端 mTLS 仍未完成；本地回环测试不能替代平台验收。
- Cloudflare 域名、Pages/Tunnel 和公网联调仍依赖有权限的账号负责人，按 `CLOUDFLARE_DOMAIN_ACTIVATION_TODO.md` 执行。
- 清洗后攻击样本 low 难度仅 1 条，是否补样由队友审核决定。
- 外部巡检指出空白 `topic` 仍可绕过前端校验，且没有战局删除接口；代码检查确认这两项尚未实现，但它们不属于本次文件清理和 SDK CI 修复，留作后续后端任务。

## 本次清理

- 删除了本机 `.env` 备份、WorkBuddy 临时记忆、第三方 `tools/` 副本、根目录构建快照、过时上游文档副本和旧合并技能包。
- 保留正式源码、测试、部署脚本、攻击/防守技能包和清洗/审计报告。
- 删除的敏感备份曾包含 API Key、数据库密码和内部配置；如其中凭据曾被用于任何外部系统，应由负责人轮换，仓库中不得恢复该文件。

## 下一步

1. 运行 GitHub Actions，确认公开 SDK 基线和 2.1/2.2 兼容修复通过。
2. 队友审核当前分支改动后，按文件冲突逐项合并到 `main`。
3. 由账号负责人完成 Cloudflare 和梧桐平台人工步骤，再做公网与真实 mTLS 验收。

## 禁止事项

- 不提交 `.env`、EAB、证书、私钥、数据库、日志、`backend/packages/` 或 Tunnel Token。
- 未获训练平台授权前，不上传清洗数据、不启动训练、不配置未批准的模型端点。
