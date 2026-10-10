# WIT Identity 迁移评估

更新时间：2026-10-11

## 已确认

- 官方流程的推荐入口是 `AcpsConfig` + `WitAgent` + `WitRuntime`，状态机通过
  `up_until_ready()` 推进，审核后再 `serve_direct_partner()`。
- 本机 `backend/packages/` 已有两个私有 wheel，但缺少官方 `release-manifest.json`；不能绕过
  SHA-256 发行预检直接安装到生产环境。
- 在隔离临时虚拟环境中验证了 wheel API：`acps-sdk 2.2.0`、`wit-framework 2.1.0`，
  `WitRuntime` 的注册、服务和停止入口均存在且为协程；离线 ACS 草稿可正常生成。
- `WitRuntime`/`AcpsRegistration` 公共 API 只有 `integrated()`、`ontology()`、`entity()` 等
  注册形态，没有发现导入现有 AIC、接管已有证书或恢复现有 Registry workspace 的入口。

## 现有身份不能直接重复注册

当前项目已有三个 AIC 与证书材料：Leader、攻击 Agent、防守 Agent。攻击/防守 ACS 仍是旧的
`apiKey` 声明，Leader ACS 已改为 `mtls`；它们不是一个全新 integrated workspace。

因此禁止直接用新的 `WitRuntime(..., workspace=...)` 调用 `up_until_ready()` 来“重新注册”同名
Agent。这样可能创建重复身份、产生新的 AIC，并使已有证书与 Registry 记录分叉。

## 正确迁移顺序

1. 负责人在 Registry/官方文档确认“既有 AIC + 证书”如何导入或接管 WIT workspace；如果平台
   不支持接管，应由负责人明确批准新 workspace 和新 Agent ID。
2. 取得官方 `release-manifest.json`，运行：

   ```powershell
   cd D:\梧桐\backend
   .\scripts\install_wit_wheels.ps1
   ```

   安装脚本现在会额外执行 `verify_wit_runtime_api.py`，确认 Identity/Direct/Group API 完整。
3. 为 Direct listener 准备 serverAuth 证书，并确保 `public_endpoint` 的 DNS/IP SAN 匹配；现有
   clientAuth 证书不能替代 serverAuth。
4. 确认队友 VPS 的 Cloudflare Tunnel/反向代理把公开 `/acps/aip/v1/rpc` 映射到 strict
   listener；当前线上 API `/rpc` 是 FastAPI + API Key 入口，不等同于 `serve_direct_partner()`。
5. 先执行 draft-only 和证书/endpoint 预检，再由负责人手动提供开发者凭据并推进注册。凭据不能
   写入项目、命令行参数、Git 或聊天。

## 当前阻塞

- 官方发行清单尚未取得。
- SSH 22 端口仍不可达，无法在 VPS 安装/验收 strict listener。
- 稳定的 Direct `/acps/aip/v1/rpc` 地址、serverAuth 证书和现有 AIC 接管流程尚未确认。
- 在上述条件完成前，线上服务继续使用现有 FastAPI `/rpc` 和 API Key/浏览器会话；不能宣称
  WIT Direct、AMP 或真实端到端 mTLS 已上线。

## 安全边界

不得提交或转发 `ACPS_USERNAME`、`ACPS_PASSWORD`、Registry token、EAB、私钥、证书内容、
Tunnel token 或数据库备份。`RegistryPasswordCredentials.from_env()` 只应在负责人自己的
受控环境读取凭据。
