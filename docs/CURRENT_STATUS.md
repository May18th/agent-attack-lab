# 当前项目状态

更新时间：2026-10-11

本文是当前状态的短版事实源；历史细节保留在 `TEAM_HANDOFF.md`、审计报告和 Git 提交记录中。

## 已验证

- 当前协作分支：`codex/team-domain-handoff`；本轮整理前基线提交为 `eeeaa86`。
- 队友远端：`origin/main` 最新 `6d713fb`；双方已分叉，未直接合并或重置。
- 在独立临时 worktree 检查 `origin/main`：针对性 ACP 测试 `10 passed`，完整后端测试 `61 passed`。
- 本分支补充旧/新 SDK 构造参数兼容和 Partner 独立身份绑定后，本机官方 SDK 2.2 环境和全新公开 SDK 2.1 环境均为 `70 passed`，仅有既有 Starlette/httpx 弃用警告。
- 微调数据：原始 105 条，保守清洗保留 72 条、剔除 33 条；清洗集未上传 Git、VPS 或训练平台。条件、数量和校验见 `FINETUNE_CLEANING_20261010.md`。

## 当前阻塞

- GitHub Actions 已在 PR `#2` 通过：后端测试、前端构建检查均为 SUCCESS；Cloudflare Pages 与 Workers Preview 也已通过。
- 生产梧桐发行包 `release-manifest.json`、稳定 Agent `/rpc` 地址和真实端到端 mTLS 仍未完成；本地回环测试不能替代平台验收。
- Cloudflare Pages 与 Workers Preview 构建已验收；生产域名、Tunnel、DNS/SSL 和公网 API 状态仍需在合并/部署后按 `CLOUDFLARE_DOMAIN_ACTIVATION_TODO.md` 复验。
- 清洗后攻击样本 low 难度仅 1 条，是否补样由队友审核决定。
- 空白 `topic` 已在服务端统一拒绝并自动去除首尾空白；已新增 `DELETE /battles/{battle_id}`，删除已结束战局时同步清理事件，运行中战局返回 409。

## 本次清理

- 删除了本机 `.env` 备份、WorkBuddy 临时记忆、第三方 `tools/` 副本、根目录构建快照、过时上游文档副本和旧合并技能包。
- 保留正式源码、测试、部署脚本、攻击/防守技能包和清洗/审计报告。
- 删除的敏感备份曾包含 API Key、数据库密码和内部配置；如其中凭据曾被用于任何外部系统，应由负责人轮换，仓库中不得恢复该文件。

## 队友审核入口

- 主提交：`5fcdf11`（ACP SDK 2.1/2.2 兼容、PowerShell 编码修复、工作区清理与文档整理）。
- 验收结果：本机后端 `74 passed`；PR `#2` 的后端/前端 GitHub Actions、Cloudflare Pages 和 Workers Preview 全部通过；前端本机 `18 passed`，lint、build 与 Wrangler dry-run 通过。
- 审核动作：审核并合并 PR `#2`；分支已合入 `main@6d713fb` 并解决冲突，当前 GitHub merge state 为 CLEAN。
- 已知问题：真实公网 mTLS 尚未验收；清洗后攻击样本 low 难度仅 1 条，是否补样待审核。
- 禁止事项：不得补交 `.env`、证书、EAB、私钥、私有 wheel、Tunnel Token 或 JSONL 数据集。

## 下一步

1. 队友审核并合并 PR `#2` 到 `main`。
2. 合并后复验生产域名、Tunnel、DNS/SSL、浏览器主流程和公网 API。
3. 取得稳定 Agent `/rpc` 与平台 mTLS 条件后，再做真实端到端身份绑定验收。

## 禁止事项

- 不提交 `.env`、EAB、证书、私钥、数据库、日志、`backend/packages/` 或 Tunnel Token。
- 未获训练平台授权前，不上传清洗数据、不启动训练、不配置未批准的模型端点。
