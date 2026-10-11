# WIT Identity 迁移评估

更新时间：2026-10-11

## 已确认

- 官方流程的推荐入口是 `AcpsConfig` + `WitAgent` + `WitRuntime`，状态机通过
  `up_until_ready()` 推进，审核后再 `serve_direct_partner()`。
- 已取得官方 `release-manifest.json`。2026-10-11 使用用户提供的正式发行目录执行
  `wit-release-preflight`，两个 wheel 的 SHA-256 与清单完全一致。
- 正式 wheel 已安装到本机后端 `.venv`：`acps-sdk 2.2.0`、`wit-framework 2.1.0`；使用
  `.venv` 解释器执行 API 预检和全量后端测试，结果为 `82 passed, 1 skipped`。
- 在隔离临时虚拟环境中验证了 wheel API：`acps-sdk 2.2.0`、`wit-framework 2.1.0`，
  `WitRuntime` 的注册、服务和停止入口均存在且为协程；离线 ACS 草稿可正常生成。
- `WitRuntime`/`AcpsRegistration` 公共 API 只有 `integrated()`、`ontology()`、`entity()` 等
  注册形态，没有发现导入现有 AIC、接管已有证书或恢复现有 Registry workspace 的入口。
- 已用正式 `wit-framework 2.1.0` 字节码交叉核对：`provisioner` 依赖
  `enrollment.json`、`registrationId`、`pendingIdentity` 和 `fetch_eab_credential`，无本地注册状态时
  明确进入“create a new workspace”路径。仅凭 AIC、Registry 账号或现有 clientAuth 证书不能
  恢复原 workspace；AIC 是身份标识，不是可迁移凭据。
- 本机递归检查只找到三个 AIC 的 `.acps-cli` clientAuth 证书、私钥、EAB 和 trust bundle；没有
  WIT workspace 的 `enrollment.json`、`acs.final.json`、`registry-token.json`、serverAuth 材料或
  AIP 状态数据库，因此本机不具备接管原身份所需的完整状态。

## 现有身份不能直接重复注册

当前项目已有三个 AIC 与证书材料：Leader、攻击 Agent、防守 Agent。攻击/防守 ACS 仍是旧的
`apiKey` 声明，Leader ACS 已改为 `mtls`；它们不是一个全新 integrated workspace。

因此禁止直接用新的 `WitRuntime(..., workspace=...)` 调用 `up_until_ready()` 来“重新注册”同名
Agent。这样可能创建重复身份、产生新的 AIC，并使已有证书与 Registry 记录分叉。

## 两条可行路径

### 路径 A：找回原 workspace

在最初运行攻击/防守 Agent 或 cloudflared 的机器、容器、持久卷、快照和备份中找回完整
`<workspace>/acps/`。必须同时保留 enrollment 状态、authoritative ACS、Registry token、EAB、
client/server 两套证书与私钥、trust bundle；不能只复制 AIC 或 clientAuth 目录。

仓库提供只读搜索脚本：

```bash
cd /opt/agent-attack-lab
bash backend/scripts/find-wit-workspaces.sh
```

脚本只输出候选路径和文件是否存在，不读取凭据内容。命中后通过受控加密通道备份整个 `acps/`
目录，不得提交 Git、发到聊天或改名拆分。固定域名变化后仍需按平台流程更新 ACS、重签覆盖新
hostname SAN 的 serverAuth，并重新验证 discovery 与 Direct listener。

### 路径 B：原 workspace 确认找不回

原身份无法凭 AIC 复活。由负责人批准为攻击/防守创建新 workspace，重新注册并取得新 AIC；
固定 RPC、serverAuth 和端到端 mTLS 验收通过后更新 discovery，并将旧 AIC 记录标记为废弃。
不得在未完成搜索和审批前对空 workspace 运行 `up_until_ready()`。

## 后续实施顺序

1. 先在原部署机器、容器卷、快照和备份中运行只读搜索，确定走路径 A 还是路径 B。
2. 使用带官方清单的发行目录安装并复验（本机已完成）：

   ```powershell
   cd D:\梧桐\backend
   .\scripts\install_wit_wheels.ps1 `
     -PackageDir "D:\梧桐\wit_v2.1.0_release"
   .\.venv\Scripts\python.exe .\scripts\verify_wit_runtime_api.py
   .\.venv\Scripts\python.exe -m pytest -q
   ```

   未指定 `-PackageDir` 时，脚本仍默认使用 `backend/packages/`。安装后应直接调用 `.venv`
   解释器或使用 `uv run --no-sync`；普通 `uv run` 可能按当前锁文件把 `acps-sdk` 同步回 2.1.0。
3. 为 Direct listener 准备 serverAuth 证书，并确保 `public_endpoint` 的 DNS/IP SAN 匹配；现有
   clientAuth 证书不能替代 serverAuth。
4. 确认队友 VPS 的 Cloudflare Tunnel/反向代理把公开 `/acps/aip/v1/rpc` 映射到 strict
   listener；当前线上 API `/rpc` 是 FastAPI + API Key 入口，不等同于 `serve_direct_partner()`。
5. 路径 A 只从找回的原状态继续并按平台规则变更身份材料；路径 B 必须由负责人批准新身份后，
   才执行 draft-only、证书/endpoint 预检并推进新注册。凭据不能写入项目、命令行参数、Git 或聊天。

## 当前阻塞

- SSH 22 端口仍不可达，无法在 VPS 安装/验收 strict listener。
- 尚未检查原 VPS、停止容器、Docker volume、快照和备份中是否存在攻击/防守完整 `acps/`。
- 稳定的 Direct `/acps/aip/v1/rpc` 地址和 serverAuth 证书尚未具备。
- 在上述条件完成前，线上服务继续使用现有 FastAPI `/rpc` 和 API Key/浏览器会话；不能宣称
  WIT Direct、AMP 或真实端到端 mTLS 已上线。

## 安全边界

不得提交或转发 `ACPS_USERNAME`、`ACPS_PASSWORD`、Registry token、EAB、私钥、证书内容、
Tunnel token 或数据库备份。`RegistryPasswordCredentials.from_env()` 只应在负责人自己的
受控环境读取凭据。
