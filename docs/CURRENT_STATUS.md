# 当前项目状态

更新时间：2026-10-11

本文是当前状态的短版事实源；历史细节保留在 `TEAM_HANDOFF.md`、审计报告和 Git 提交记录中。

## 生产 mTLS 最新状态（2026-10-11）

- 已在 `47.108.92.113` 通过 nginx 启用 `attack.yuanyiagentzhandui.cn` 和
  `defense.yuanyiagentzhandui.cn` 的 443 TLS；`/health` 免客户端证书，`/rpc` 强制
  clientAuth，后端 8788/8789 仍只监听 `127.0.0.1`。
- Cloudflare 两条 Partner 记录已为 `A -> 47.108.92.113`、DNS only；没有直接把旧
  `cfargotunnel.com` CNAME 灰云化。主 API 命名隧道继续保留作为独立入口和回滚通道。
- 远端 Partner 应用层旧 `AGENT_RPC_API_KEY` 已移除；Leader API 仍保留自己的浏览器/API
  鉴权。Leader 使用已同步的 clientAuth 证书和 trust bundle 访问两个固定公网 endpoint。
- Linux 端公网验收：两个 `/health` 均 HTTP 200；两个 `/rpc` 无客户端证书均 HTTP 403；
  带合法 clientAuth 证书均完成 TLS 并进入应用层。Leader 到攻击、防守真实 AIP 调用均返回
  结构化结果；VPS 上 low/mid/high 三档战局均创建 HTTP 201 并完成 `completed`。
- 当前 nginx 负责传输层 mTLS，Partner 应用不启用依赖直连 Uvicorn TLS socket 的 SDK
  `identity_binding_enabled`；这是 TLS 在 nginx 终止时的边界设计，不代表关闭公网 mTLS。

平台 Discovery 已于 2026-10-11 实测返回两个新 AIC 均为 `active`，authoritative ACS
endpoint 分别为固定 attack/defense RPC 地址，且 endpoint security 声明为 `mtls`。负责人
已确认旧 AIC 已在平台删除；项目验收记录称 Discovery 已同步，旧 AIC 不再收录。远端 `.env` 和
systemd 备份均留在服务器受限目录，未进入 Git。

项目验收记录（2026-10-11，本机未独立复验）：Discovery 仅命中 Leader 与两个新 Partner，三者
均为 `active`，endpoint 正确且声明 `mutualTLS`；两个旧 AIC 不再收录。桌面端与移动端分别完成
low/mid/high 六场战局，全部为 `completed`。移动自动化改用 `deviceScaleFactor=1` 与
`requestSubmit()` 后通过，布局无溢出。公网证书可信、`/health` 为 200、无证书 `/rpc` 为 403；
17:07 和 18:07 两次巡检正常。

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
- 稳定 Agent `/rpc` 地址、serverAuth、源站 nginx mTLS、Registry authoritative ACS/Discovery 均已有验收结果；项目验收记录称旧 AIC 不再被 Discovery 收录。
- 管理员已确认攻击/防守使用新 workspace、新 AIC；旧 AIC 已从平台删除，不再作为恢复目标。
- 已新增 `backend/scripts/register_partner_agents.py`：默认仅生成/校验两个独立 integrated 草稿；显式 `--submit` 才提交 Registry，凭据只从当前进程环境读取。
- 两个新 Partner 已由本机完成注册并进入 `active`：攻击 AIC `1.2.156.3088.1.BUPT.RX2TMW.LMB4VK.NJ99P0.08RN`，防守 AIC `1.2.156.3088.1.BUPT.RX2TMW.KYUDTI.BI8UKQ.09SG`；Discovery 实测已确认 authoritative ACS 固定 endpoint 和 `mtls` 安全声明，证书材料已同步 VPS 受限目录。
- mTLS 生产切换已完成：nginx 443 双域名按路径强制 clientAuth，Partner 后端只监听回环地址；主 API 命名隧道保留，Partner 不再依赖应用层 API Key。
- 预部署核验：远端 8787/8788/8789 `/health` 均返回 200，四个用户级服务 active；两套 serverAuth 的 SAN/EKU/有效期正确，`server/certificate.pem` 均包含 leaf + Agent CA Intermediate，使用对应 trust bundle 验证为 OK。443 部署必须保持完整证书链，并使用 `backend/scripts/verify-partner-mtls.sh` 做公网握手验收。
- 源站 nginx 已安装并启用 443 双域名 mTLS；公网直连验收为 `/health` 200、无证书 `/rpc` 403、合法 clientAuth `/rpc` 进入应用层。阿里云安全组已放行 443，attack/defense DNS 为 A 记录 DNS only。
- VPS `47.108.92.113:22` 已恢复；公网 API、固定 Partner 域名和用户级服务常驻状态均已核验。
- 正式发行物和本机运行时预检已经通过；该结果只解除发行物完整性阻塞，不代表 Registry 注册、WIT Direct 或生产 mTLS 已完成。
- Cloudflare Pages 与 Workers Preview 构建已验收；生产域名、Tunnel、DNS/SSL 和公网 API 状态仍需在合并/部署后按 `CLOUDFLARE_DOMAIN_ACTIVATION_TODO.md` 复验。
- 清洗后攻击样本 low 难度仅 1 条，是否补样由队友审核决定。
- 已建立独立外部安全案例库导入脚本 `backend/scripts/import_external_cases.py`；首批从 CISA 官方 KEV JSON 导入目录版本 `2026.10.08` 的 1,739 条记录，全部标记 `verified_primary`、`synthetic=0`，数据库位于被忽略的 `.data/external_security_cases.sqlite3`。新增 `record_kind` 来源分层和只读 `--validate` 校验，当前 1,739 条全部通过；这些记录是外部事实参考，不自动视为本项目战局或攻击样本。
- 本机针对空白 topic 与删除战局的定向测试均通过（2 passed）。VPS 当前提交 `61beebe` 的 OpenAPI 不含 `DELETE /battles/{battle_id}`；本地实现提交 `7edf500` 不在当前 `origin/main`（`6d713fb`），与生产 405 相符。生产空主题 POST 未直接测试，避免旧版本接受请求时创建真实战局。

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

1. 通过团队审核把包含 `7edf500` 的正确代码合入部署分支并更新 VPS；随后验证 DELETE 路由，再在安全环境验证空白 topic POST 返回 422。
2. 既有验收记录中的 `battle-694dce7f` 在本机数据库和 VPS 默认 `backend/.data/battles.sqlite3` 均未找到，无需执行删除；若它来自其他数据库，需先确认数据源再清理。
3. 由负责人决定是否接入外部 LLM；当前攻击/防守 Agent 使用规则兜底。外部案例库后续只接入可核验的一手来源，并经人工复核。
4. 负责人已确认停用每小时巡检；本机 Windows 任务计划和 VPS systemd timers/user crontab 均未找到对应任务，因此本轮未能停用。实际任务若位于外部平台，需由该平台所有者在其控制台停止。

## 禁止事项

- 不提交 `.env`、EAB、证书、私钥、数据库、日志、`backend/packages/` 或 Tunnel Token。
- 未获训练平台授权前，不上传清洗数据、不启动训练、不配置未批准的模型端点。
