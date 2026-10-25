# Codex 执行任务书：v2 Partner 切换收尾

> 由 WorkBuddy 交接。所有路径相对 `D:\梧桐`。凭据只从环境变量 `ACPS_USERNAME` / `ACPS_PASSWORD` 读取，**不得写入任何文件、不得提交 git**。

## 0. 当前状态（2026-10-25 20:55）

已完成：
- 攻击/防守两只 v2（版本 1.1.0）已注册并**自动审核通过**（20:43），证书已签发，状态 `active`。
- 新 AIC：
  - 攻击 `1.2.156.3088.1.BUPT.RX2TMW.S5AJC0.A8O5XB.0S0Q` → registrationId `01a17310-c8b1-72f8-bc26-ac00d2703b8d`
  - 防守 `1.2.156.3088.1.BUPT.RX2TMW.QY650M.GD00U5.1AIR` → registrationId `01a17310-cf08-707c-ba9c-09c99339c5a1`
- `backend/agent-identities.json` 已回填新 AIC；本机三服务已重启，心跳已按新 AIC 上报（`.data/amp/amp_heartbeat_*.jsonl` 最新行可核对）。
- 新证书位置：
  - `backend/.data/acps-registration-v2/attack/acps/{server,client}/{certificate.pem,private-key.pem}` + `trust-bundle.pem`
  - `backend/.data/acps-registration-v2/defender/acps/` 同上

未完成（本任务要做的）：
1. 梧桐 Discovery **尚未同步**新 ACS。变更流里已有（`GET https://wt.ioa.pub/registry-server/acps-dsp-v2/changes?seq=1720&limit=50`，seq 1727/1728）。20:50 复测按 AIC 缺省查询仍返回 0 条。
2. 旧 1.0.0 两条记录还在（现役旧身份），需在验证新记录可见后删除。
3. VPS `47.108.92.113:22` 的 nginx 仍在使用旧 AIC 的 server 证书，本轮 SSH 连接超时未能更换。

## 1. 任务 A：等 Discovery 同步并验证检索（先做）

按顺序，每 60 秒重试一次，最多 20 分钟：

```bash
# A1 按 AIC 精确查，走平台缺省参数（含 alive=online）
curl -s --noproxy "*" -X POST https://wt.ioa.pub/discovery/acps-adp-v2/discover \
 -H "Content-Type: application/json" \
 -d '{"type":"filtered","filter":{"conditions":[{"field":"aic","op":"eq","value":"1.2.156.3088.1.BUPT.RX2TMW.S5AJC0.A8O5XB.0S0Q"}]}}'
```
- `result.acsMap` 长度为 1、`version` 为 `1.1.0`、`skills[0].name` 为「攻击样本生成」才算通过。防守 AIC 同样验一遍（技能名「攻击样本检测」）。

```bash
# A2 语义检索（发现页搜索框走的就是这条）
curl -s --noproxy "*" -X POST https://wt.ioa.pub/discovery/acps-adp-v2/discover \
 -H "Content-Type: application/json" \
 -d '{"type":"explicit","query":"攻击智能体","limit":12}'
```
判定：`acsMap` 的 key 里出现上面两个新 AIC 之一即通过。再用「防守智能体」验一次。

> 注意：A2 是本次改版的**核心验收标准**。旧 1.0.0 在改版前对这两个词是 0 命中。

## 2. 任务 B：删除旧 1.0.0（必须 A 全部通过后才做）

顺序不可颠倒：**先确认新记录可被检索，再删旧记录**，否则线上会出现无可用 Partner 的空窗。

1. 登录取 token：
```bash
curl -s -X POST https://wt.ioa.pub/registry-server/api/v1/auth/login \
 -H "Content-Type: application/x-www-form-urlencoded" \
 --data-urlencode "grant_type=password" --data-urlencode "username=$ACPS_USERNAME" --data-urlencode "password=$ACPS_PASSWORD"
```
2. 删除（逐个，删前先 `GET /api/v1/agent/client/{id}` 确认 `version=1.0.0`、`approval_status=APPROVED`）：
   - 攻击 `01a12993-ce5a-7608-841f-c7e8a8c9cbcb`
   - 防守 `01a12993-d55c-73f6-b285-620895566bf3`
   - `DELETE https://wt.ioa.pub/registry-server/api/v1/agent/client/{id}`，带 `Authorization: Bearer <token>`
3. 删除后立即复验任务 A 的 A1/A2，仍能命中新记录才算成功。
4. **不要删主调度** `01a124e4-7810-738e-9eee-1f59a1119c97`。

## 3. 任务 C：VPS 更换 Partner 证书（尽力而为）

- `ssh -i ~/.ssh/id_aliyun_deploy deployer@47.108.92.113`（本轮超时，若仍不可达就跳过并在报告里写明）。
- 若可达：只读确认 attack/defense 两个 server block 的证书路径（`nginx -T`），把新证书/私钥（`.../server/certificate.pem`、`.../server/private-key.pem`）放到原位置，私钥 `600`，`nginx -t` 通过后 `systemctl reload nginx`。
- 改动前先备份旧证书，记录回滚命令。
- 不得改 DNS、不得动 Cloudflare、不得改数据库。

## 4. 约束

- 不执行 `git commit` / `git push` / 分支操作。
- 不改 `backend/.env` 之外的配置文件；`.env` 里只允许改 `AGENT_AIP_EXPECTED_PARTNER_AIC`/`AGENT_LOCAL_AIC` 相关行。
- 不删除、不移动任何 `backend/.data/acps-registration-*` 目录（内含私钥）。
- 不把 AIC 之外的任何凭据、token、私钥内容写进仓库或日志。

## 5. 产出

把结果写到 `docs/CODEX_EXEC_REPORT.md`，包含：A1/A2 每轮时间点与命中数、B 的删除结果与新记录复验结果、C 的连通性与处理结果、未完成项与原因。
