# Leader mTLS 独立入口落地手册（1.2.1）

更新时间：2026-10-26 00:30
前置文档：`docs/LEADER_MTLS_DECISION.md`（决策与顺序修正）

## 一、已完成

| 项 | 状态 |
|---|---|
| 1.2.1 主调度注册 | `registrationId = 01a173d3-f433-7240-9f3b-17cf13a7f486` |
| 审核结果 | **已通过**（2026-10-26 00:20，自动审核：Endpoint 或 Web URL 满足准入要求 + 大模型公序良俗审核通过） |
| 新 AIC | `1.2.156.3088.1.BUPT.RX2TMW.KOPA19.GA39CB.1A7Q` |
| 草稿版本与 endpoint | `version=1.2.1`，`endPoints=[https://leader-mtls.yuanyiagentzhandui.cn/rpc]` |
| serverAuth 证书 | **已随注册流程签发**，`.data/acps-registration-v4-leader-mtls/leader/acps/server/` |
| clientAuth 证书 | **同上，已签发**，同目录 `client/` |
| 注册脚本参数化 | `--version/--endpoint/--workspace` 已入库，可复现 |
| DNS 记录 | `leader-mtls` → A → `47.108.92.113`，**仅 DNS（灰云）**，已用阿里公共 DNS 与系统解析双向确认 |
| nginx 模板 | `backend/deploy/nginx/leader-mtls.conf.template`，与现网逐行对齐 |
| 1.2.0 现状 | 未改动，三只仍在线（`0U7Q / 0MVE / 0GFQ`），`api` 入口照常 |

### 证书实测（openssl 3.5.7）

```
server/certificate.pem
  subject = CN=1.2.156.3088.1.BUPT.RX2TMW.KOPA19.GA39CB.1A7Q, O=智能体攻防实验室项目组, C=CN
  issuer  = CN=Agent CA Intermediate Certificate
  EKU     = TLS Web Server Authentication (critical)
  SAN     = URI:acps://...1A7Q, DNS:leader-mtls.yuanyiagentzhandui.cn     ← 关键项正确
  notAfter= Oct 25 16:21:08 2027 GMT
  PEM 内含 2 张证书（叶子 + 中间 CA）

client/certificate.pem
  subject = 同 AIC
  EKU     = TLS Web Client Authentication (critical)
  私钥    = ED25519
```

**不需要再跑 `issue_acps_certificate.ps1`**——`AcpsRegistration.integrated()` 在注册流程里已经把 serverAuth 与 clientAuth 都签好了。该脚本还依赖仓库外的 `acps-cli.exe`，本机已不存在，且需交互式输入凭据，不要再去走那条路。

### 1.2.1 当前在平台上的可见性（实测）

- 按名称查发现页：**仍是 3 条，全部 1.2.0**。1.2.1 不上报 AMP 心跳，因此不进在线列表。
- 按新 AIC `...1A7Q` 精确查：**命中 0**（离线）。
- 只有登录注册平台后台「我的智能体」才看得到 4 条（两条同名主调度）。

含义：**只要不切心跳，1.2.1 在评委常见的发现页里不可见，重复记录风险低于预期**。但反过来，切换一旦发生就是原子的——Leader 心跳只能报一个 AIC，切了 1.2.1，1.2.0 的 `0U7Q` 立刻开始掉线（约 2–3 分钟窗口）。

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

### 1. 把证书送到 VPS（当前唯一卡点）

证书在本机 `backend/.data/acps-registration-v4-leader-mtls/leader/acps/`，VPS 上需要落到 `/home/deployer/.config/agent-attack-lab/partners/leader/workspace/acps/`。

**私钥绝对不能进 Git。** 本机到 VPS 的 22 端口被云侧安全组挡死，只有 self-hosted runner 能在 VPS 内执行，而 runner 无法从本机取文件。两条可行路径：

**路径 A：GitHub Secret 中转（可自动，需授权）**
`server/private-key.pem` 与 `server/certificate.pem` 写入 repository secret，由 workflow 在 VPS 落盘到目标路径、`chmod 600`、再删 secret。私钥会短暂存在于 GitHub Secrets（加密存储，仅本仓库 Actions 可读）。

**路径 B：控制台通道手动上传（不经第三方）**
用阿里云控制台 VNC，或临时在安全组放行本机公网 IP 到 22，`scp` 上去后立刻收回规则。

**无论哪条路径，落盘后必须核对指纹**：VPS 上 `openssl x509 -noout -fingerprint -sha256` 的结果要与本机一致，再往下走。

`ca-verify.pem` 不需要传：直接复用 attack 现有那份（同一 Agent CA Root，subject `CN=Agent CA Root Certificate`，2036-07-11 到期），与现网两个入口保持完全一致。

### 2. 落 nginx 配置

在 `backend/deploy/nginx/leader-mtls.conf.template` 里把 `__CERT_DIR__` 替换成实际路径，把结果**追加**到 `/etc/nginx/sites-enabled/agent-attack-lab-mtls.conf` 末尾（不要新建 sites-enabled 文件）。

```
sudo -n nginx -t          # 必须 syntax is ok
sudo -n systemctl reload nginx
```

**`nginx -t` 失败就立即回滚**（删掉追加的 block 再 reload），不要带着坏配置 reload，否则 attack/defense 入口一起挂。

### 3. 验收（未开始）

| 检查 | 期望 |
|---|---|
| `https://leader-mtls.yuanyiagentzhandui.cn/health` | 200（无客户端证书也应通，与 attack 一致） |
| `https://leader-mtls.yuanyiagentzhandui.cn/rpc` 无证书 | 403（不是 404、不是 502） |
| 带 Leader clientAuth 证书调 `/rpc` | 200，返回 AIP 响应 |
| `https://attack.../rpc` 与 `https://defense.../rpc` | 行为不变，未被新 block 影响 |
| `https://api.yuanyiagentzhandui.cn/dashboard` | 仍可登录，前端未受影响 |

### 4. 切换身份（原子动作，不可回退到"两条都在线"）

前置：上面验收全部通过。

1. `backend/agent-identities.json` 的 `leader.aic` 改为 `...1A7Q`
2. `backend/tests/test_amp_heartbeat.py` 的 `LEADER_AIC` 常量同步（不同步 CI 立刻红）
3. 生产 `.env` 的 Leader client 证书换成 1.2.1 的，AIC 同步
4. 比赛报名表的 Leader AIC（`0U7Q` 将失效，约 2–3 分钟后掉线）
5. `docs/TECH_EVIDENCE_PACK.md`、答辩材料、`scripts/verify_amp_alive.py` 的比对值

`start-service.sh` 的角色注入按模块走，不写死 AIC，**不需要改**。

**这一步开始后 `0U7Q` 会真的掉线**，中间约 2–3 分钟两条都不在线。不要放在演示前 30 分钟内做。

## 四、终止条件（比完成更重要）

出现下列任一情况，**停止推进并保持 1.2.0 为唯一对外身份**：

- VPS 上证书指纹与本机不一致 —— 传输过程有问题，不要继续。
- `nginx -t` 反复失败且原因不明 —— 不要在生产上反复试。
- 验收五项有任何一项不符合预期，且 30 分钟内定位不到原因。
- 演示前 24 小时内任何一步未完成 —— 冻结现状，演示用 1.2.0。

已被排除的旧条件：审核已通过、AIC 已下发、证书 SAN 已确认含 `DNS:leader-mtls.yuanyiagentzhandui.cn`。

理由：ACS 审核通过后不可修改，AIC 冻结。一个 endpoint 不可达的 1.2.1 记录留在平台上，比没有这条记录更难解释——虽然它不上报心跳就不会出现在发现页，但登录注册平台后台就能看到两条同名主调度。

## 五、一个反向选择：也可以就停在这里

当前状态（1.2.1 已过审、证书已签、DNS 已通、nginx 未配、心跳未切）**本身是稳定且无副作用的**：

- 发现页只显示 1.2.0 的三只，评委按名称或 AIC 搜索都不会看到 1.2.1。
- `0U7Q` 等在报名表里的值继续有效。
- 1.2.1 相当于一份"随时可启用"的备用身份。

如果答辩材料不打算把"服务端身份可校验的独立 mTLS 入口"作为亮点讲，那么**停在当前状态、把 4 天全部投入演示视频与成效数据，收益更高**。切换会带来报名表改号、约 2–3 分钟的双离线窗口、以及六处 AIC 同步的出错机会。

判断标准很简单：**这个架构优化能不能在答辩里换回分数**。换不回来就别切。

## 六、与他人协作的接口

- nginx block 追加操作可由 `deployer` 免密 sudo 经 self-hosted runner 完成，**不需要 SSH 22**；证书文件的传入是唯一需要额外通道的环节（见三.1）。
- 只读诊断入口：`gh workflow run diagnose-nginx.yml`（输出 server block、证书 subject/SAN/到期、监听端口，不含密钥内容）。
- DNS 变更只能由有 Cloudflare 权限的人做，仓库内无 CF API 凭据。
