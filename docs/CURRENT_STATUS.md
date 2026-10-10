# 当前项目状态

更新时间：2026-10-11

本文是当前状态的短版事实源；历史细节保留在 `TEAM_HANDOFF.md`、审计报告和 Git 提交记录中。

## 已验证

- 当前协作分支：`codex/team-domain-handoff`；本轮整理前基线提交为 `eeeaa86`。
- 队友远端：`origin/main` 最新 `6d713fb`；双方已分叉，未直接合并或重置。
- 在独立临时 worktree 检查 `origin/main`：针对性 ACP 测试 `10 passed`，完整后端测试 `61 passed`。
- 本分支补充旧/新 SDK 构造参数兼容和 Partner 独立身份绑定后，本机官方 SDK 2.2 环境和全新公开 SDK 2.1 环境均为 `70 passed`，仅有既有 Starlette/httpx 弃用警告。
- 微调数据：原始 105 条，保守清洗保留 72 条、剔除 33 条；清洗集未上传 Git、VPS 或训练平台。条件、数量和校验见 `FINETUNE_CLEANING_20261010.md`。
- 身份绑定预检已区分 Leader 与 Partner 开关；开关打开但当前 SDK 不支持服务端身份绑定参数时会失败关闭，不再静默丢弃配置。
- 新增 VPS 只读常驻验收脚本；已在 `47.108.92.113` 实机确认 `deployer` 的 `linger=yes`，API/攻击/防守/Tunnel 四个用户级服务均为 `enabled` 且运行中。
- 新增 WIT Identity 迁移评估：隔离环境确认私有 wheel API 可生成 ACS 草稿，但未发现接管现有 AIC/workspace 的公开 API；在平台确认前禁止重复 `integrated()` 注册。
- 官方 `release-manifest.json` 已取得，两个正式 wheel 的 SHA-256 与清单一致；使用正式目录安装后版本为 `acps-sdk 2.2.0`、`wit-framework 2.1.0`，WIT API 预检通过，后端全量测试 `82 passed, 1 skipped`。
- Cloudflare 命名隧道 `yuanyi-agent-attack-lab-backend` 已增加 `attack -> 8788`、`defense -> 8789` ingress 及两个 Proxied CNAME；固定域名 `/health` 均为 200，Partner 未带 API Key 的 `/rpc` 返回 401，带正确密钥返回 200。旧 Registry Partner Quick Tunnel 已无 DNS；这仍不是平台 mTLS 已上线的证据。
- 正式 WIT 2.1 字节码与本机文件审计确认：现有 AIC 不能接管空 workspace。本机只有三组 `.acps-cli` clientAuth 材料，没有 `enrollment.json`、authoritative ACS、Registry token、serverAuth 或 WIT AIP 状态；必须先在原部署机/容器卷/备份找完整 `acps/`，找不到则只能经负责人批准重新注册新 AIC。

## 当前阻塞

- GitHub Actions 已在 PR `#2` 通过：后端测试、前端构建检查均为 SUCCESS；Cloudflare Pages 与 Workers Preview 也已通过。
- 稳定 Agent `/rpc` 地址已部署并验收；serverAuth 证书和真实端到端 mTLS 仍未完成，本地 API Key 验收不能替代平台 mTLS 验收。
- Registry authoritative ACS 仍登记已失效 Quick Tunnel；平台客户端接口规定 APPROVED Agent 不能由普通账号更新，需平台工作人员保留原 AIC 执行端点迁移并同步 Discovery。当前本地 ACS 文件已改为固定域名，但不代表 Registry 已更新。
- 原 VPS、容器卷、快照和备份尚未完成完整 `acps/` 搜索；这是决定保留旧 AIC 还是重新注册的前置判定。
- VPS `47.108.92.113:22` 已恢复；公网 API、固定 Partner 域名和用户级服务常驻状态均已核验。
- 正式发行物和本机运行时预检已经通过；该结果只解除发行物完整性阻塞，不代表 Registry 注册、WIT Direct 或生产 mTLS 已完成。
- Cloudflare Pages 与 Workers Preview 构建已验收；生产域名、Tunnel、DNS/SSL 和公网 API 状态仍需在合并/部署后按 `CLOUDFLARE_DOMAIN_ACTIVATION_TODO.md` 复验。
- 清洗后攻击样本 low 难度仅 1 条，是否补样由队友审核决定。
- 已建立独立外部安全案例库导入脚本 `backend/scripts/import_external_cases.py`；首批从 CISA 官方 KEV JSON 导入目录版本 `2026.10.08` 的 1,739 条记录，全部标记 `verified_primary`、`synthetic=0`，数据库位于被忽略的 `.data/external_security_cases.sqlite3`。新增 `record_kind` 来源分层和只读 `--validate` 校验，当前 1,739 条全部通过；这些记录是外部事实参考，不自动视为本项目战局或攻击样本。
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

1. 将攻击、防守两个 AIC 和固定 endpoint 发给 Registry 管理员，请其执行已审核 Agent 的端点迁移并同步 Discovery；禁止新建重复 Agent。
2. 平台变更完成后，按 AIC 查询 authoritative ACS，并执行 low/mid/high 全链路验收。
3. 仍需在原 VPS、容器卷、快照和备份中搜索完整 `acps/` workspace；不得读取或回传凭据正文。
4. 外部案例库后续只接入可核验的一手来源；每条记录保留来源、版本、采集时间、内容哈希和原始字段，先运行 `uv run python backend/scripts/import_external_cases.py --validate`，经过人工复核后才可脱敏改编为合成测试场景。

## 禁止事项

- 不提交 `.env`、EAB、证书、私钥、数据库、日志、`backend/packages/` 或 Tunnel Token。
- 未获训练平台授权前，不上传清洗数据、不启动训练、不配置未批准的模型端点。
