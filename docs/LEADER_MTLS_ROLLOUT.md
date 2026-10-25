# Leader mTLS 独立入口落地手册（1.2.1）

更新时间：2026-10-26 00:30
前置文档：`docs/LEADER_MTLS_DECISION.md`（决策与顺序修正）

## 一、已完成

| 项 | 状态 |
|---|---|
| 1.2.1 主调度注册提交 | `registrationId = 01a173d3-f433-7240-9f3b-17cf13a7f486`，`pending_review` |
| 草稿版本与 endpoint | `version=1.2.1`，`endPoints=[https://leader-mtls.yuanyiagentzhandui.cn/rpc]` |
| 注册脚本参数化 | `--version/--endpoint/--workspace` 已入库，可复现 |
| DNS 记录 | `leader-mtls` → A → `47.108.92.113`，**仅 DNS（灰云）**，已用阿里公共 DNS 与系统解析双向确认 |
| nginx 模板 | `backend/deploy/nginx/leader-mtls.conf.template`，与现网逐行对齐 |
| 1.2.0 现状 | 未改动，三只仍在线（`0U7Q / 0MVE / 0GFQ`），`api` 入口照常 |

## 二、生产实测现状（2026-10-26 00:27，经 self-hosted runner 只读取得）

- nginx `1.26.3`，`active`。
- 配置文件只有两个：`/etc/nginx/sites-enabled/agent-attack-lab-mtls.conf` 与 `default`。
- `agent-attack-lab-mtls.conf` 内含 **两个** server block：`attack`（→ `127.0.0.1:8788`）与 `defense`（→ `127.0.0.1:8789`）。**没有 leader 的 block**，主调度目前只经 Cloudflare Tunnel 的 `api` 域名对外。
- 每个 block 的关键指令：`ssl_verify_client optional` + `location /rpc` 内 `if ($ssl_client_verify != SUCCESS) { return 403; }`。**`optional` 不是放松，真正的强制在 location 里**，这样 `/health` 才能在无客户端证书时探活。
- `listen 443 ssl default_server` 在 `default` 站点里是**注释状态**，即没有默认 443 server。SNI 未匹配时落到第一个 443 block（attack），所以现在用 `leader-mtls` 访问会拿到 attack 的证书、校验失败——这与实测表现一致。
- 后端监听：`8787`（主调度）、`8788`（攻击）、`8789`（防守）、`8790` 均在 `127.0.0.1`。
- `systemctl --user list-units` 在 runner 用户下为空（服务归属 `deployer` 的 user session，runner 看不到，不影响运行）。

**证书 SAN 实测（这条印证了注册顺序）**：

```
attack  证书 subject=CN=...C2049I.0MVE
        SAN = URI:acps://...C2049I.0MVE, DNS:attack.yuanyiagentzhandui.cn
defense 证书 subject=CN=...JN4O8Y.0GFQ
        SAN = URI:acps://...JN4O8Y.0GFQ, DNS:defense.yuanyiagentzhandui.cn
```

DNS SAN 就是 ACS 里填的 endpoint 主机名。所以 **1.2.1 的 endpoint 必须已经写好 `leader-mtls`，签出来的证书才带这个 SAN**——先注册后签证书的顺序是对的，不能颠倒。

## 三、剩余步骤

### 1. 等审核通过，拿新 AIC

审核通过后 `enrollment.json` 的 `review.aic` 会从 `null` 变成新 AIC。查询方式：

```powershell
cd D:\梧桐\backend
python -c "import json;d=json.load(open('.data/acps-registration-v4-leader-mtls/leader/acps/enrollment.json',encoding='utf-8'));print(d['status'], (d.get('review') or {}).get('aic'))"
```

### 2. 签 serverAuth 与 clientAuth 证书

```powershell
cd D:\梧桐\backend
.\scripts\issue_acps_certificate.ps1 -Aic <新AIC> -Usage serverAuth
.\scripts\issue_acps_certificate.ps1 -Aic <新AIC> -Usage clientAuth
```

签完先自检 SAN 是否含 `DNS:leader-mtls.yuanyiagentzhandui.cn`，不含就别往下走。

### 3. 把证书与配置落到 VPS

证书目录形如 `/home/deployer/.config/agent-attack-lab/partners/leader/workspace/acps/`，需确认实际路径（`issue_acps_certificate.ps1` 的 `-OutputRoot` 决定）。

在 `backend/deploy/nginx/leader-mtls.conf.template` 里替换 `__CERT_DIR__`，把结果**追加**到 `/etc/nginx/sites-enabled/agent-attack-lab-mtls.conf` 末尾（不要新建 sites-enabled 文件）。

落盘后必须先 `nginx -t`：

```
sudo -n nginx -t          # 必须 syntax is ok
sudo -n systemctl reload nginx
```

**`nginx -t` 失败就立即回滚**（删掉追加的 block 再 reload），不要带着坏配置 reload，否则 attack/defense 入口一起挂。

### 4. 验收

| 检查 | 期望 |
|---|---|
| `https://leader-mtls.yuanyiagentzhandui.cn/health` | 200（无客户端证书也应通，与 attack 一致） |
| `https://leader-mtls.yuanyiagentzhandui.cn/rpc` 无证书 | 403（不是 404、不是 502） |
| 带 Leader clientAuth 证书调 `/rpc` | 200，返回 AIP 响应 |
| `https://attack.../rpc` 与 `https://defense.../rpc` | 行为不变，未被新 block 影响 |
| `https://api.yuanyiagentzhandui.cn/dashboard` | 仍可登录，前端未受影响 |

第 3 项通过后再切生产的 AIP 调用地址。

### 5. 同步 AIC（漏一处就会重演本轮 CI 红）

1. `backend/agent-identities.json` 的 `leader.aic`
2. `backend/tests/test_amp_heartbeat.py` 的 `LEADER_AIC` 常量
3. 生产 `.env` 的 Leader client 证书与 AIC
4. 比赛报名表的 Leader AIC（`0U7Q` 将失效）
5. `docs/TECH_EVIDENCE_PACK.md` 与答辩材料里的 AIC
6. `scripts/verify_amp_alive.py` 的验收输出比对

`start-service.sh` 的角色注入按模块走，不写死 AIC，**不需要改**。

## 四、终止条件（比完成更重要）

出现下列任一情况，**停止推进并保持 1.2.0 为唯一对外身份**：

- 审核在 10/28 之后仍未通过 —— 后续四步做不完，宁可不切。
- 证书 SAN 不含 `leader-mtls` —— 注册信息与实际不符，需重新提交，本次放弃。
- `nginx -t` 反复失败且原因不明 —— 不要在生产上反复试。
- 演示前 24 小时内任何一步未完成 —— 冻结现状，演示用 1.2.0。

理由：ACS 审核通过后不可修改，AIC 冻结。一个 endpoint 不可达的 1.2.1 记录留在平台上，比没有这条记录更难解释。

## 五、与他人协作的接口

- 本手册产出的 nginx block 追加操作可由 `deployer` 免密 sudo 经 self-hosted runner 完成，**不需要 SSH 22**。
- 只读诊断入口：`gh workflow run diagnose-nginx.yml`（输出 server block、证书 subject/SAN/到期、监听端口，不含密钥内容）。
- DNS 变更只能由有 Cloudflare 权限的人做，仓库内无 CF API 凭据。
