# 前端交接后端联调清单

更新时间：2026-10-07

## 1. 当前结论

前端本地功能和本地前后端联调已完成。当前唯一阻塞项是公网 Cloudflare Tunnel 尚未恢复，`https://api.kcwx.online` 仍返回 HTTP 503。

## 2. 需要后端处理

### 2.1 重启命名 Tunnel

请在后端电脑以管理员身份执行：

```powershell
Restart-Service Cloudflared
```

确认命名 Tunnel `agent-attack-lab` 仍将以下域名转发到本机后端：

```text
api.kcwx.online -> http://127.0.0.1:8787
```

不要重复创建 DNS 记录，也不要修改前端的 DNS 配置。

### 2.2 公网接口验收

Tunnel 恢复后，请依次验证：

- `GET https://api.kcwx.online/health` 返回 HTTP 200；
- `POST /battles` 使用 `low`、`mid`、`high` 分别创建战局；
- 返回内容包含 `attackerOut`、`defenderOut` 和 `status`；
- 记录失败请求的 `X-Request-ID`，用于后端日志定位。

## 3. 前端联调配置

前端使用以下 API 地址：

```env
VITE_AGENT_API=https://api.kcwx.online
```

前端不会使用 `api.orangecc.cc`，也不会修改 DNS、Tunnel、数据库、证书或后端接口字段。

## 4. 前端已完成

- FE-01 至 FE-09：工程、环境变量、API 客户端、表单、主流程、结果展示和异常处理；
- FE-11 至 FE-16：历史列表、详情恢复、健康状态、安全文本展示、响应式布局和测试；
- 加载状态、历史列表加载状态和健康检查失败后的点击重试；
- 本地前端测试：`8 passed`；
- 本地前端 `npm run build`：通过；
- 本地后端 `GET /health`：HTTP 200；
- 本地 `POST /battles`：HTTP 201，攻击样本和防守结果均正常返回。

## 5. 待公网恢复后复核

- FE-10 公网首轮联调；
- 页面创建 `low`、`mid`、`high` 三种难度战局；
- 页面显示 `attackerOut.samples`；
- 页面显示 `defenderOut.caught`、`risks`、`fixed`；
- 历史列表和战局详情恢复；
- 空主题、超长主题、重复点击、网络失败和 5xx 提示；
- 记录最终公网地址、提交版本和 `X-Request-ID`。

## 6. 暂不纳入本轮联调

以下内容属于 P2 后续扩展，不阻塞当前版本：

- WebSocket；
- arbiter；
- score、round、correlationId；
- 实时事件时间线。
