# Partner 智能体重新注册（v2，1.1.0）

目标：让「攻击智能体」「防守智能体」在梧桐平台**发现页搜索**里能被搜到。

## 1. 为什么必须重新注册

两个独立的原因叠在一起，只有重注册能同时解决：

| 问题 | 实测证据 |
| --- | --- |
| 发现页搜索是**语义检索**，`name` 字段不进索引 | 用完整名称 `智能体攻防实验室-攻击智能体` 查询，返回 11 条，**没有我们自己**；用 `攻击样本生成` 查询，立即命中 |
| 旧版 ACS 元数据太薄 | 攻击 `description` 仅 17 字、防守 22 字，技能 `name` 是英文 `attack_capability` / `defender_capability`，无 `examples`（Leader 是 138 字 + 中文技能名 + 2 条 examples，所以能被搜到） |
| ACS 审核通过后平台禁止修改 | `PUT /api/v1/agent/client/{agent_id}` 的说明：「更新 Agent，审核通过的不能再更新」。注册侧没有其他 ACS 变更接口 |

> 结论：旧 AIC（`...NJ99P0.08RN` / `...BI8UKQ.09SG`）的元数据已冻结，只能带新元数据重新注册。

## 2. 已准备好的东西（本地，未提交）

| 项目 | 位置 | 说明 |
| --- | --- | --- |
| 注册脚本（v2） | `backend/scripts/register_partner_agents.py` | 版本 `1.1.0`、新 workspace `.data/acps-registration-v2`、新 `agent_id`（`*-v2`） |
| 元数据 | 同上 | 描述扩到 119 / 94 字，覆盖红队、蓝队、提示词注入、越狱、指令劫持、数据泄露、工具滥用、风险检测、修复建议；技能名改为中文「攻击样本生成」「攻击样本检测」；各 3 条 `examples`；tags 细化 |
| 隔离环境 | `backend/.venv-register` | `wit 2.1.0` 要求 `acps_sdk 2.2.0`，而共用 `.venv` 里是 2.0.0（`src/` 运行时依赖它，不能随便升） |
| 草稿 | `backend/.data/acps-registration-v2/{attack,defender}/acps/acs.draft.json` | 已生成，`valid: true`，`aic` 为空（符合「由 Registry 分配新 AIC」） |
| AIC 回填脚本 | `backend/scripts/adopt_partner_aics.py` | 审核通过后读 `enrollment.json`，把新 AIC / registrationId 写回 `agent-identities.json` |
| 一键收尾脚本 | `backend/scripts/finalize_partner_v2.py` | 轮询审批；通过后自动签发证书、取回新 AIC；`--write` 才写回身份文件 |

## 2.1 当前进度（2026-10-25 20:40）

| 记录 | 版本 | agent_id | 状态 |
| --- | --- | --- | --- |
| 攻击 | 1.1.0 | `01a17310-c8b1-72f8-bc26-ac00d2703b8d` | **PENDING**（待平台审核） |
| 防守 | 1.1.0 | `01a17310-cf08-707c-ba9c-09c99339c5a1` | **PENDING**（待平台审核） |
| 攻击 | 1.0.0 | `01a12993-ce5a-7608-841f-c7e8a8c9cbcb` | APPROVED + 在线（现役，暂不删） |
| 防守 | 1.0.0 | `01a12993-d55c-73f6-b285-620895566bf3` | APPROVED + 在线（现役，暂不删） |
| 攻击 / 防守 | 1.0.1 | `01a101d7-…` / `01a101d5-…` | 已删除（平台返回 `Deleted agents cannot be deleted again`） |

提交账号 `3498414260@qq.com` 只有 `CLIENT` 角色，`staff/{id}/auto-review`、`staff/{id}/process` 调不了，**审核必须由平台工作人员完成**。


## 3. 提交注册（凭据只在你本机）

```powershell
cd D:\梧桐\backend
$env:ACPS_USERNAME = "<平台账号>"
$env:ACPS_PASSWORD = "<平台密码>"
.venv-register\Scripts\python.exe scripts\register_partner_agents.py --agent both --submit
Remove-Item Env:ACPS_USERNAME,Env:ACPS_PASSWORD
```

- 不加 `--submit` 只生成草稿、不发网络请求。
- `--agent attack` / `--agent defender` 可单只处理。
- 平台的自动准入审核可能通过，也可能转人工；脚本输出的 `status` / `nextAction` 会说明当前状态。
- 凭据不写文件、不进命令行参数、不进 Git。

## 4. 审核通过后要做的四件事

**① 等审批 + 签发证书 + 回填 AIC**

```powershell
$env:ACPS_USERNAME = "<平台账号>"
$env:ACPS_PASSWORD = "<平台密码>"
# 轮询到通过后自动签发证书并打印新 AIC；确认后加 --write 写回身份文件
.venv-register\Scripts\python.exe scripts\finalize_partner_v2.py --poll 120
Remove-Item Env:ACPS_USERNAME,Env:ACPS_PASSWORD
```

只想看状态、不进注册流程时，直接跑 `finalize_partner_v2.py`（不带 `--poll`）。

**② 换证书**：新 AIC 对应新证书（`enrollment.json` 里 `certificateIssue.status = issued` 后生成）。把新证书/私钥同步到 VPS `/home/deployer/.config/agent-attack-lab/partners/`（私钥 `600`），本机与 VPS 同步更新：

- `AGENT_AIP_MTLS_CERT_FILE` / `AGENT_AIP_MTLS_KEY_FILE` / `AGENT_AIP_CA_FILE`
- `AGENT_LOCAL_AIC`（两个 Partner 进程各自设成自己的新 AIC）
- `AGENT_AIP_EXPECTED_PARTNER_AIC`（调用方一侧）

**③ 重启并验收**

```powershell
cd D:\梧桐\backend
.\restart.ps1
.venv\Scripts\python.exe scripts\verify_amp_alive.py --wait 60
```

再按发现页口径验一次语义检索：

```bash
curl -s --noproxy "*" -X POST https://wt.ioa.pub/discovery/acps-adp-v2/discover \
 -H "Content-Type: application/json" \
 -d '{"type":"explicit","query":"攻击智能体","limit":12}'
```

**④ 删掉旧 1.0.0**（顺序很重要：新版本可用之后再删，避免空窗）

| 角色 | 旧 registrationId |
| --- | --- |
| 攻击 | `01a12993-ce5a-7608-841f-c7e8a8c9cbcb` |
| 防守 | `01a12993-d55c-73f6-b285-620895566bf3` |

`DELETE /api/v1/agent/client/{agent_id}`（需要登录态）。删之前确认新 AIC 的 `/rpc` 已通过 mTLS 验收。

## 5. 风险与注意

- **新 AIC 会变**，旧 AIC 上的心跳、证书、Leader 映射全部要跟着换；这是本次操作的主要成本。
- 平台若保留 1.0.0 与新 1.1.0 同时在线，会短时间出现同名两个智能体，属于预期过渡态，第 ④ 步清理。
- 审核通过前不要删旧版本，否则线上会断。
- 若平台人工审核要求说明用途，可用：攻击端为隔离环境内的安全测试样本生成，防守端为样本风险识别与修复建议，均不访问真实目标。
