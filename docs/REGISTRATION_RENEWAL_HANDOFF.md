# Partner 重新注册交接

管理员已确认攻击 Agent 和防守 Agent 不能恢复原 workspace，改走新 workspace、新 AIC 注册。

## 已确认的固定 endpoint

| Agent | 注册前 endpoint | 健康检查 |
| --- | --- | --- |
| 攻击 | `https://attack.yuanyiagentzhandui.cn/rpc` | `https://attack.yuanyiagentzhandui.cn/health` |
| 防守 | `https://defense.yuanyiagentzhandui.cn/rpc` | `https://defense.yuanyiagentzhandui.cn/health` |

2026-10-11 复测：三个固定域名的 `/health` 均返回 HTTP 200。Windows 上若默认代理导致攻击域名 TLS 失败，使用 `curl --noproxy "*"` 复测；不能据代理错误判断 Tunnel 失效。

## 注册方式

两个 Partner 分别创建独立 workspace，使用 `AcpsRegistration.integrated()`。不要使用旧 AIC、旧 registration ID、旧 Quick Tunnel 或旧 workspace 状态文件。注册草稿中的 `aic` 必须为空，由 Registry 分配新 AIC。

本地候选文件：

- `backend/acs-attack-trusted-registration.json`
- `backend/acs-defender-trusted-registration.json`

这两个文件不包含运行时 API Key、证书、私钥、EAB 或 Tunnel token。平台审核时只提交 ACS candidate；凭据和证书留在负责人本机的受限 workspace。

本项目提供执行入口。默认只生成并校验草稿：

```powershell
cd D:\梧桐\backend
.venv\Scripts\python.exe scripts\register_partner_agents.py --agent both
```

确认无误后，在本机当前进程临时设置 `ACPS_USERNAME`、`ACPS_PASSWORD`，再显式提交：

```powershell
$env:ACPS_USERNAME = "<仅在本机输入>"
$env:ACPS_PASSWORD = "<仅在本机输入>"
.venv\Scripts\python.exe scripts\register_partner_agents.py --agent both --submit
Remove-Item Env:ACPS_USERNAME,Env:ACPS_PASSWORD
```

两个 Agent 使用独立 workspace；凭据不会写入 workspace、命令行参数或 Git。

## 注册后必须回填和验收

1. 分别记录新的 `aic`、`registrationId` 和审核状态；不要覆盖另一个 Agent 的身份。
2. 审核通过后获取各自 EAB，签发并验证 clientAuth/serverAuth 证书和 trust bundle。
3. 将 authoritative ACS 的 endpoint 确认为上表固定域名，并确认 Discovery 已同步。
4. 重新配置 Leader 的 Partner AIC/endpoint 映射，删除旧 AIC 映射。
5. 先用受控凭据做 `/rpc` 验收，再执行 low/mid/high 全链路验收。

## 当前结果（2026-10-11）

| Agent | 新 AIC | registrationId | 状态 | authoritative endpoint |
| --- | --- | --- | --- | --- |
| 攻击 | `1.2.156.3088.1.BUPT.RX2TMW.LMB4VK.NJ99P0.08RN` | `01a12993-ce5a-7608-841f-c7e8a8c9cbcb` | `active` | `https://attack.yuanyiagentzhandui.cn/rpc` |
| 防守 | `1.2.156.3088.1.BUPT.RX2TMW.KYUDTI.BI8UKQ.09SG` | `01a12993-d55c-73f6-b285-620895566bf3` | `active` | `https://defense.yuanyiagentzhandui.cn/rpc` |

两套 Partner 均已签发并本地验证 `clientAuth`、`serverAuth` 和 trust bundle；证书有效期至
2027-10-11。证书和私钥已同步到 VPS 的 `/home/deployer/.config/agent-attack-lab/partners/`
受限目录，私钥权限为 `600`，远端文件与本机哈希一致。业务服务仍使用现有 API Key 入口，
strict mTLS listener 尚未切换，不能把材料同步描述为公网 mTLS 已验收。

## mTLS 链路阻塞（2026-10-11）

源站只读核验结果：VPS 只有 `127.0.0.1:8787/8788/8789`，没有 `443` 或 `8443` 监听，
也没有 nginx、Caddy 或 HAProxy；Cloudflare Tunnel 当前把橙云 HTTPS 公共证书终止在边缘，
因此客户端实际拿到的不是梧桐 serverAuth 证书。`deployer` 当前没有免密 sudo，不能由本账号
安全地绑定 443、修改系统反代或切换 DNS。已完成的 workspace 同步不等于 mTLS 上线。

下一条人工部署动作（需服务器管理员提供 root/sudo 或执行）是：在源站用对应 workspace
的 server certificate/private key/trust bundle 配置 443 mTLS listener，`/rpc` 强制客户端证书，
`/health` 可单独保留健康检查；随后将两个 DNS 记录改为 DNS only（灰云）或使用明确支持端到端
mTLS 的代理方案。完成前不要切换 Leader 到 mTLS，也不要关闭现有 API Key Tunnel。

## 禁止事项

- 不要把 Registry 用户名、密码、token、EAB、私钥、证书正文或 Tunnel token 写入 Git、聊天或 ACS。
- 不要把 API Key/HTTPS 验收描述为真实 mTLS；真实 mTLS 需 serverAuth、trust bundle 和端到端握手共同通过。
- 不要在审核前把新 AIC 写入 Leader 生产配置；等两个 Partner 都 active 且 Discovery 同步后再切换。
