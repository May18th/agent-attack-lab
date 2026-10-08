# 梧桐 ACPs 证书接入

这份说明对应梧桐官方“使用 SDK 开发智能体”流程。项目当前是 FastAPI + AIP v2 服务，先使用平台官方 `acps-cli` 获取身份材料，再把 clientAuth 证书接入 `acp_agents.py` 的出站 mTLS 客户端。

## 1. 官方前置条件

必须先在 [梧桐智能体注册平台](https://wt.ioa.pub/registry/) 完成：

1. 准备并提交攻击、防守两个 ACS。
2. 审核通过后分别取得两个 AIC。
3. 从平台或官方发行目录取得与梧桐匹配的 `acps-cli`。

AIC 只能作为已分配身份使用，不能自行编造。账号、密码、验证码和人工审核必须在本机完成，不要发到聊天或提交 GitHub。

## 2. 配置 CLI

复制模板并保持真实配置只在本机：

```powershell
cd "D:\梧桐\backend"
Copy-Item .\acps-cli.toml.example .\acps-cli.toml
```

模板使用梧桐手册给出的生产地址：

```toml
[registry]
base_url = "https://wt.ioa.pub/registry-server"

[ca]
base_url = "https://wt.ioa.pub/ca-server"

[discovery]
base_url = "https://wt.ioa.pub/discovery"
```

先做本地预检，不会登录或申请证书：

```powershell
.\scripts\verify_acps_cli.ps1
```

如果官方 CLI 不在项目旁的 `tools\ACPs-community\...`，用 `-CliPath` 指定官方可执行文件。社区仓库只能作为命令结构参考，不能据此证明生产端点兼容。

## 3. 登录、获取 EAB、签发证书

先登录。ACPs 2.2.0 的生产配置使用标准 OIDC 设备授权：终端会显示一次性代码，用户在浏览器确认；不要把 OIDC 密码、验证码或设备码发到聊天。命令会在终端等待登录完成，Token 由 CLI 写入配置指定的本机文件：

```powershell
acps-cli --config .\acps-cli.toml auth login
```

不要把旧版的 `--username`/`--password` 参数写入自动化脚本；只有平台明确启用本地认证时才按官方 CLI 帮助执行。

为每个已审核 AIC 单独申请证书。项目包装脚本会保存 EAB、私钥、证书和信任包到被忽略的本机目录：

```powershell
.\scripts\issue_acps_certificate.ps1 `
  -Aic "<攻击 AIC>" `
  -Usage clientAuth

.\scripts\issue_acps_certificate.ps1 `
  -Aic "<防守 AIC>" `
  -Usage clientAuth
```

脚本默认显式申请 Ed25519 私钥（ACPs 2.2.0 默认算法）。如平台为旧材料明确要求其他算法，才使用 `-KeyType rsa` 或 `-KeyType ec`；旧 RSA/EC 证书不会自动迁移。

如果 Agent 监听器本身需要严格 mTLS，还需要按平台要求再申请 `serverAuth` 证书；当前 FastAPI Agent 的公网入口由 HTTPS/Tunnel 和 API Key 保护，尚未迁移为 `WitRuntime.serve_direct_partner()` 的严格 mTLS listener。

## 4. 证书检查与接线

申请完成后，可检查证书、信任包和私钥是否存在，并在有 OpenSSL 时核对证书链、公钥匹配、SAN 和 EKU：

```powershell
.\scripts\inspect_acps_certificate.ps1 `
  -CertificatePath ".\.acps-cli\certs\<aic-path>\clientAuth\agent-cert.pem" `
  -TrustBundlePath ".\.acps-cli\certs\<aic-path>\clientAuth\trust-bundle.pem" `
  -KeyPath ".\.acps-cli\certs\<aic-path>\clientAuth\agent-key.pem"
```

在启动主服务的同一 PowerShell 会话设置：

```powershell
$env:AGENT_AIP_MTLS_CERT_FILE = "D:\梧桐\backend\.acps-cli\certs\...\agent-cert.pem"
$env:AGENT_AIP_MTLS_KEY_FILE = "D:\梧桐\backend\.acps-cli\certs\...\agent-key.pem"
$env:AGENT_AIP_CA_FILE = "D:\梧桐\backend\.acps-cli\certs\...\trust-bundle.pem"
$env:AGENT_AIP_LEADER_ID = "<主调度 Agent 的真实 AIC>"
```

随后配置攻击/防守 Agent 的真实 `/rpc` 地址并重启主服务。地址必须是 `/rpc`，不是网页首页；证书必须和平台登记的 endpoint、AIC 以及对端信任链一致。

## 5. 安全边界

- 不提交 `acps-cli.toml`、`.acps-cli/`、EAB、Token、`.pem`、`.key` 或任何密码。
- `AGENT_AIP_MTLS_*` 只在后端进程环境中设置，公开前端不接触这些变量。
- 证书文件存在不等于远端调用已成功；仍需从后端主机执行真实 AIP 战局验收，并记录 HTTP、TLS、AIP 状态和结果来源。
- 证书申请失败时保留错误信息即可，不要用自签名证书或虚构 AIC 继续联调。

## 6. ACPs 2.2.0 能力边界

- AMP 心跳、指标、访问、消息、系统和审计记录由平台的 monitor-server 负责；当前项目的 `/metrics` 和战局事件是本地应用遥测，不能冒充 AMP 上报。
- AIP 流式/通知和 TLS 证书 AIC 绑定需要安装匹配的官方 SDK/wit 发行包后再接入；当前 `acp_agents.py` 仅使用已安装 SDK 的轮询式 RPC，未宣称支持流式或通知。
- AAC 访问控制和 OIDC 是平台服务侧能力；当前后端 API Key/浏览器会话鉴权不能替代 Agent 间 mTLS，也不能替代 Registry/Monitor 的 OIDC 授权。
- Ansible image-mode/host-mode 安装属于平台部署层，不纳入本地开发启动脚本；正式部署时按平台安装包和 inventory 执行 `site.yml` 及续签、升级、回滚 playbook。
