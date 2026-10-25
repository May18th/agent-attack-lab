# Leader mTLS 独立入口：决策记录（2026-10-25 23:55）

## 背景

切换 VPS 证书时发现一个 TLS 冲突：

- Leader 的 server 证书由**私有 Agent CA** 签发，只有带梧桐 trust bundle 的 AIP 客户端能验证，浏览器默认不信任。
- 项目前端也走 `https://api.yuanyiagentzhandui.cn`。该域名若改为 DNS-only 直连 VPS 并挂这张证书，浏览器会直接报证书不受信任，前端 API 全挂。
- 若保持 Cloudflare 橙云代理，外部调用方看到的是 CF 边缘证书，看不到 Leader 的 Agent CA 证书，mTLS 身份等于失效。

结论：**api 域名不能既服务浏览器前端、又做 mTLS 身份入口。** 这个判断成立。

## 备选方案的代价

为 Leader 单独开 `leader-mtls.yuanyiagentzhandui.cn` 需要：

1. 新域名 DNS 记录（DNS-only → 47.108.92.113）
2. nginx 新 server block + `ca-verify.pem`
3. 该域名对应的 **serverAuth 证书**——Agent CA 只按 ACS 里的 endpoint 签发，所以必须先注册一版 endpoint 为新域名的 Leader
4. 平台审核 → 新 AIC → 新 clientAuth 证书 → VPS `.env` 与 systemd 服务更新

## 暂不执行的三个理由

1. **会再次更换 Leader AIC。** 比赛报名表刚填入当前 AIC `1.2.156.3088.1.BUPT.RX2TMW.4IR05L.P3MRLO.0U7Q`，再注册一版立刻失效，需要同步改表，出错概率高。今天已经因 AIC 变更改过多轮。
2. **不解决任何现存故障。** 三只智能体当前都是 1.2.0、`active`、生产在线、发现页可检索、可调用。新入口属于架构优化，不是修复。
3. **落地条件不具备。** VPS SSH `deployer@47.108.92.113:22` 今日持续超时，DNS/nginx 改动无法执行。此时提交注册只会得到一个「已注册但没启用」的半成品，平台上多出一条同名 1.2.1 记录，且 ACS 审核通过后不可修改，后续方案再变又得重注册。

## 当前处置

- v1.2.1 Leader 草稿已生成但**未提交**，隔离在工作区 `backend/.data/acps-registration-v4-leader-mtls/`，endpoint 为 `https://leader-mtls.yuanyiagentzhandui.cn/rpc`，不覆盖 1.2.0 的注册产物。
- 生产维持现状：api 域名继续走 Cloudflare Tunnel 服务前端；三只智能体继续用 1.2.0 身份。
- 唯一实际欠账仍是**把 VPS nginx 与 Leader client 证书换成 1.2.0 的**，操作见 `VPS_CERT_SWAP_V3.md`。这件事不需要新域名、不需要换 AIC，SSH 一通就能做。

## 重新评估的触发条件

满足任一条件再启动 mTLS 独立入口：

- 出现必须校验服务端 AIC 的外部 AIP 调用方；
- 比赛/演示结束，AIC 不再需要冻结；
- VPS SSH 恢复，且能一次性完成 DNS + nginx + 证书 + `.env` 的全套变更与回滚验证。

## 如果仍要执行，正确顺序

先定域名与证书方案 → 再提交注册（注册决定证书 SAN）→ 再配 DNS 与 nginx → 最后切 `.env` 并验收。**不能先改 DNS**，否则会出现域名已直连、证书还不匹配的空窗。

## 补充：2026-10-26 00:20 已按此方案提交 1.2.1，但顺序需修正一处

**已发生的事**：v1.2.1 主调度已提交注册，`registrationId = 01a173d3-f433-7240-9f3b-17cf13a7f486`，状态 `pending_review`。草稿 `version=1.2.1`，`endPoints` 指向 `https://leader-mtls.yuanyiagentzhandui.cn/rpc`。1.2.0 与 `api` 入口未改动，现有三只智能体身份仍是 `0U7Q / 0MVE / 0GFQ`，平台在线可检索。

**修正：`leader-mtls` 属于全新子域名，"不能先改 DNS"这条不适用，必须提前加。** 上面那条空窗风险针对的是**改造现有 `api` 域名**——把正在服务前端的域名从橙云切成 DNS-only，才会出现"域名已直连、证书还不匹配"的空窗。`leader-mtls` 是没有任何流量的新主机名，先加一条 DNS-only A 记录指向 `47.108.92.113` 不会影响任何现有服务。

**且不加 DNS 会直接卡住后续两步**：

1. `issue_acps_certificate.ps1` 要求 `-Aic`，而 AIC 只在审核通过后分配；Agent CA 按 ACS 里的 endpoint 签发 `serverAuth` 证书，主机名 `NXDOMAIN` 时签发与验证都会失败。
2. 平台审核若对 endpoint 做可达性探测，`NXDOMAIN` 是最容易被驳回的状态。

实测（2026-10-26 00:15）：`leader-mtls.yuanyiagentzhandui.cn` 在阿里公共 DNS 返回 `Status: 3`（NXDOMAIN），无 Answer。对照组 `api` 有 A 记录（Cloudflare 代理），`attack` 直连 `47.108.92.113`。

因此修正后的执行顺序：

1. **加 DNS**：`leader-mtls` → DNS-only A → `47.108.92.113`（与 `attack` 同型，不加橙云，否则 mTLS 身份被 CF 边缘终结）
2. 等审核通过 → 拿新 AIC
3. `issue_acps_certificate.ps1 -Aic <新AIC> -Usage serverAuth`（同时换 Leader 的 clientAuth）
4. VPS 加 nginx server block + `ca-verify.pem`（`deployer` 有 NOPASSWD sudo，可走 self-hosted runner，不需要 SSH）
5. 切 `.env` 与 systemd，跑 `verify_amp_alive.py` 与一次真实 AIP 调用验收
6. 同步 AIC：`agent-identities.json`、`tests/test_amp_heartbeat.py` 的 `LEADER_AIC`、报名表、答辩材料与证据包

**时间窗风险**：截止 10/30。若审核在 10/29 之后才通过，第 3–5 步来不及做完，平台会留下一条 endpoint 不可达的 1.2.1 记录且审核通过后 ACS 不可修改。**这种情况下应立即停止推进、保留 1.2.0 作为唯一对外身份**，不要让半成品上线。

## 添加 DNS 记录时最容易点错的一处：代理状态必须关

Cloudflare 的「添加记录」面板默认把「代理状态」置于**橙云（已代理）**。这里必须点成**灰云（仅 DNS）**再保存。

**为什么不能开橙云**：mTLS 的双向认证要求调用方在 TLS 握手中校验服务器出示的、由 Agent CA 签发的 Leader 证书。一旦开启代理，TLS 握手在 Cloudflare 边缘就终结了，外部看到的永远是 CF 的边缘证书，Agent CA 那张证书根本不会被出示，**服务端 AIC 的身份校验等于失效**。这与本文开头第 9 行记录的冲突是同一个原因。

**已有现成对照**：同区里 `attack` 这条记录是 `A → 47.108.92.113`、状态「仅 DNS」，它是可用的 mTLS 入口；`api` 是橙云（`172.67.184.221`），因为它只服务浏览器前端、不做 mTLS。`leader-mtls` 要跟 `attack` 同型。

**这个错误最阴的地方在于它不会当场报错**：开橙云后，Cloudflare 会用自己的边缘证书把站点服务起来，域名可解析、HTTPS 可访问、证书签发时的 HTTP 验证甚至可能通过——一切看起来都成功，只有真实 AIP 调用方的 mTLS 校验会失败，而且失败点在调用方那一侧，从我们这边查不到任何异常。等演示当天才发现，已经来不及改（ACS 已审核通过、AIC 已冻结）。

**保存后的自查**：DNS 生效后查解析结果，应当是 `47.108.92.113`。若返回 `104.x / 172.67.x` 这类 Cloudflare 边缘地址，说明橙云没关，必须回去改。

---

## 结论（2026-10-26 01:07 收尾）

本文开头写"1.2.0 三只在线可调用，1.2.1 属于净损失"，**那个前提后来被证伪了**。

真实情况是：主调度 `/rpc` 挂了 `api_key_dependency`，生产 `AGENT_API_KEY` 已设，而平台 AIP 调用不会带我们的私有 key。所以 1.2.0 的主调度是"平台上在线、被调就 401"。这个 key 也删不掉——`check_api_key()` 在 key 为空且 `browser_password`/Cloudflare Access 已配置时同样 401。

于是 1.2.1 不是"可选的亮点"，而是**唯一能同时做到"在线、可调、服务端身份可校验"的路径**：mTLS 完成强身份认证后，由 nginx 注入内部 key，业务层不必知道共享密钥。

最终状态（已上线）：

| 项 | 值 |
|---|---|
| 主调度 AIC | `1.2.156.3088.1.BUPT.RX2TMW.KOPA19.GA39CB.1A7Q`（ACPs 1.2.1） |
| 主调度 endpoint | `https://leader-mtls.yuanyiagentzhandui.cn/rpc` |
| 鉴权卸载 | `/etc/nginx/leader-mtls-auth.conf`（root 600，不进 Git） |
| 双态探测 | 无证书 `POST /rpc` 403；带证书 200（进应用层，非 401） |
| 发现页 | 3 条在线：`1A7Q` / `0MVE` / `0GFQ` |

遗留：平台 Registry 里 1.2.0 主调度旧记录仍在（已离线、不出现在发现页），删除需管理员会话；报名表里的 `0U7Q` 需改为 `1A7Q`。
