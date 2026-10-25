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
| 证书落盘到 VPS | **已完成**，经 Secret 中转，指纹与私钥配对均校验通过 |
| nginx server block | **已上线并 reload**，`nginx -t` 无冲突 |
| mTLS 验收 | **六项全过**，带证书访问 `/rpc` 返回 401（非 403），TLS 双向认证成立 |
| 心跳切换 | **未执行**（保持 1.2.0，见第四节） |
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

## 三、已完成：证书落盘、nginx 配置、mTLS 验收

### 1. 证书落盘（2026-10-26 00:40）

走 GitHub Secret 中转：`LEADER_MTLS_SERVER_CERT` / `LEADER_MTLS_SERVER_KEY` 写入 repository secret，由 `provision-leader-mtls.yml` 在 VPS 内落盘。

实测结果：

| 检查 | 结果 |
|---|---|
| 落盘路径 | `/home/deployer/.config/agent-attack-lab/partners/leader/workspace/acps/server/` |
| 文件权限 | `-rw------- deployer deployer` |
| SHA-256 指纹 | `D7:A0:57:...:74:09:F8`，与本机**一致** |
| SAN | `URI:acps://...1A7Q, DNS:leader-mtls.yuanyiagentzhandui.cn` |
| 私钥配对 | `openssl x509 -pubkey` 与 `openssl pkey -pubout` 摘要相同 |
| ca-verify.pem | 复用 attack 那份 Agent CA 根（`sudo cat` 读取，直接 cp 被拒） |

### 2. nginx 配置（2026-10-26 00:40，00:43 修复）

`leader-mtls` server block 已追加到 `agent-attack-lab-mtls.conf`，`nginx -t` 通过并 reload。

**踩到并修掉一个自己造成的问题**：`sites-enabled/agent-attack-lab-mtls.conf` 是指向 `sites-available` 的**软链接**。首次用 `cp -a` 备份，`-a` 保留了链接属性，产出的"备份"是**指向同一文件的第二个软链接**；`include /etc/nginx/sites-enabled/*;` 通配把它一并加载，同一份配置被读两次，`attack` / `defense` / `leader-mtls` 三个 `server_name` 全部 `conflicting`，后者被 `ignored`。更糟的是那个"备份"回滚时等于 `cp` 自己到自己，等于没有回滚能力。

修法（`repair-nginx-dup.yml` + `provision-leader-mtls.yml` 均已改）：备份移到 `/etc/nginx/backup/`，用 `cp -L -a` 解引用，`cmp` 校验一致；`nginx -t` 出现 `conflicting server name` 一律按失败处理并回滚。

真实备份：`/etc/nginx/backup/agent-attack-lab-mtls.conf.20261026-004355`（6216 字节）。

### 3. 验收：六项全过（runner 内部 + 本机外部双视角）

runner 内部探测：

| 探测点 | 期望 | 实际 |
|---|---|---|
| `leader-mtls /health` | 200 | 200 OK |
| `leader-mtls /rpc` 无证书 | 403 | 403 OK |
| `leader-mtls /dashboard` | 404 | 404 OK |
| `attack /rpc` 无证书 | 403 | 403 OK |
| `defense /rpc` 无证书 | 403 | 403 OK |
| `api /health` | 200 | 200 OK |

本机 Python 实测（`curl` 走 Windows schannel 对 Agent CA 链一直握手失败，attack/defense 也是如此，故改用 ssl 模块）：

| 用例 | 期望 | 实际 |
|---|---|---|
| 无证书 `GET /health` | 200 | 200，返回 `{"status":"ok",...}` |
| 无证书 `POST /rpc` | 403 | 403（nginx 拒绝） |
| **带 Leader clientAuth 证书 `POST /rpc`** | **非 403** | **401** —— nginx 客户端证书校验通过，请求进入后端，401 是后端的 API 密钥鉴权 |
| 带证书 `GET /health` | 200 | 200 |

**服务端出示的证书已确认是 leader-mtls 自己的**：`subject=CN=...1A7Q`、`SAN=DNS:leader-mtls.yuanyiagentzhandui.cn`。修复前 SNI 未匹配会落到第一个 443 block（attack）并出示 attack 的证书。

结论：**mTLS 入口已可用**。`401 而非 403` 是这个结论的关键证据——它说明 TLS 层的双向认证通过了，剩下的只是业务层 API 密钥，与 mTLS 无关。

## 四、剩余最后一步：切换身份（未执行）

### 为什么停在这里

mTLS 入口通了，但**心跳还没切**，所以平台上 1.2.1 仍是离线、发现页仍只有 1.2.0 的三只。切换是原子的，且会让报名表里的 `0U7Q` 失效。

### 切换清单


前置：上面验收全部通过。

1. `backend/agent-identities.json` 的 `leader.aic` 改为 `...1A7Q`
2. `backend/tests/test_amp_heartbeat.py` 的 `LEADER_AIC` 常量同步（不同步 CI 立刻红）
3. 生产 `.env` 的 Leader client 证书换成 1.2.1 的，AIC 同步
4. 比赛报名表的 Leader AIC（`0U7Q` 将失效，约 2–3 分钟后掉线）
5. `docs/TECH_EVIDENCE_PACK.md`、答辩材料、`scripts/verify_amp_alive.py` 的比对值

`start-service.sh` 的角色注入按模块走，不写死 AIC，**不需要改**。

**这一步开始后 `0U7Q` 会真的掉线**，中间约 2–3 分钟两条都不在线。不要放在演示前 30 分钟内做。

## 五、终止条件（比完成更重要）

出现下列任一情况，**停止推进并保持 1.2.0 为唯一对外身份**：

- VPS 上证书指纹与本机不一致 —— 传输过程有问题，不要继续。
- `nginx -t` 反复失败且原因不明 —— 不要在生产上反复试。
- 验收五项有任何一项不符合预期，且 30 分钟内定位不到原因。
- 演示前 24 小时内任何一步未完成 —— 冻结现状，演示用 1.2.0。

已被排除的旧条件：审核已通过、AIC 已下发、证书 SAN 已确认含 `DNS:leader-mtls.yuanyiagentzhandui.cn`。

理由：ACS 审核通过后不可修改，AIC 冻结。一个 endpoint 不可达的 1.2.1 记录留在平台上，比没有这条记录更难解释——虽然它不上报心跳就不会出现在发现页，但登录注册平台后台就能看到两条同名主调度。

## 六、一个反向选择：也可以就停在这里

当前状态（1.2.1 已过审、证书已签、DNS 已通、**nginx 已配且 mTLS 验收通过**、心跳未切）是**稳定且无副作用**的：

- 发现页只显示 1.2.0 的三只，评委按名称或 AIC 搜索都不会看到 1.2.1。
- `0U7Q` 等在报名表里的值继续有效，三只始终在线。
- 1.2.1 的 mTLS 入口已经真的能用（`/rpc` 带客户端证书可进后端），相当于一份"随时可切换"的备用身份。
- attack / defense / api 三个存量入口行为未变，回归测试已覆盖。

如果答辩材料不打算把"服务端身份可校验的独立 mTLS 入口"作为亮点讲，那么**停在这里、把剩余时间全部投入演示视频与成效数据，收益更高**。切换会带来报名表改号、约 2–3 分钟的双离线窗口、以及六处 AIC 同步的出错机会。

判断标准很简单：**这个架构优化能不能在答辩里换回分数**。换不回来就别切。

**注意一个时间陷阱**：切心跳本身只要几分钟，但它会让 `0U7Q` 掉线。如果评审已经开始按现有 AIC 抽查，切换窗口要避开评审时段，不要放在演示或答辩当天。

## 七、与他人协作的接口

- nginx block 追加操作可由 `deployer` 免密 sudo 经 self-hosted runner 完成，**不需要 SSH 22**；证书文件的传入是唯一需要额外通道的环节（见三.1）。
- 只读诊断入口：`gh workflow run diagnose-nginx.yml`（输出 server block、证书 subject/SAN/到期、监听端口，不含密钥内容）。
- DNS 变更只能由有 Cloudflare 权限的人做，仓库内无 CF API 凭据。
