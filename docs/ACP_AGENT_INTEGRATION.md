# 独立 ACP Agent 接入

## 当前实现

战局调度器分别支持独立攻击 Agent 和独立防守 Agent，通过 ACPs SDK 2.1.0 的 AIP v2 `AipRpcClient.start_task()` 发起 Start 任务。

- 配置 `AGENT_ATTACKER_RPC_URL` 后，攻击样本改由该 AIP JSON-RPC 服务生成。
- 配置 `AGENT_DEFENDER_RPC_URL` 后，每个样本会逐个发送给该 AIP JSON-RPC 服务检测。
- 某个角色未配置 URL 时，该角色明确使用本地规则引擎。
- URL 已配置但远端超时、协议错误或输出结构错误时，战局失败，不会静默回退到本地规则。
- 后台实时事件、战局结果中的 `agentSource` 会区分 `acp` 和 `local-rule`。

`POST /agent/attack`、`POST /agent/defend` 和本服务的 `/rpc` 仍是本地演示 Agent 入口；独立 Agent 的战局编排发生在 `POST /battles`。

## 已查到的地址边界

本地 `backend/acs-attack-trusted-registration.json` 与 `backend/acs-defender-trusted-registration.json` 的 `endPoints.url` 指向同一个临时 Cloudflare `/rpc`。当前仓库 `/rpc` 的 AIP `on_start` 处理器执行的是本地 `attack()` / `defend()`，所以这是本项目的演示入口，不是队友分别部署的独立攻击/防守 Agent 地址；不要把它配置成 `AGENT_ATTACKER_RPC_URL` 或 `AGENT_DEFENDER_RPC_URL`，否则会回调本服务自身。该临时域名是否仍在线无法仅由登记 JSON 确认。

已通过 GitHub CLI 检查 `May18th/agent-attack-lab` 私有仓库的 `main` 文件树与关键配置名；当前未发现独立攻击/防守 Agent 地址或 URL 配置。梧桐平台注册目录需要实际的平台登录会话，本地没有可验证的平台目录结果。

## 配置

### 本机启动本项目的两只独立 Agent

在 `D:\梧桐\backend` 运行 `.\start-agents.ps1` 会分别启动攻击 Agent（默认 `127.0.0.1:8788/rpc`）和防守 Agent（默认 `127.0.0.1:8789/rpc`）。服务仅绑定回环地址，供本机后端验收，不能被公网平台或另一台电脑访问。停止时运行 `.\stop-agents.ps1`。

然后在后端启动所用的 PowerShell 会话配置：

```powershell
$env:AGENT_ATTACKER_RPC_URL = "http://127.0.0.1:8788/rpc"
$env:AGENT_DEFENDER_RPC_URL = "http://127.0.0.1:8789/rpc"
```

当前开发机的 `NO_PROXY` 是分号分隔格式，而 `httpx` 期望逗号分隔；如果出现 `InvalidURL`，在同一会话设置 `$env:NO_PROXY = "localhost,127.0.0.1,::1"` 与 `$env:no_proxy = "localhost,127.0.0.1,::1"`，再启动/重启后端。

在启动后端的 PowerShell 窗口设置两个独立 Agent 的公网 AIP RPC 地址。URL 必须指向服务的 `/rpc` 接口，不是前端页面 URL：

```powershell
$env:AGENT_ATTACKER_RPC_URL = "https://attacker.example/rpc"
$env:AGENT_DEFENDER_RPC_URL = "https://defender.example/rpc"
$env:AGENT_AIP_LEADER_ID = "<平台分配给本 Agent 的真实 AIC>"
cd "D:\梧桐\backend"
.\restart.ps1
```

如服务端要求 mTLS，使用平台下发的真实证书路径：

```powershell
$env:AGENT_AIP_MTLS_CERT_FILE = "D:\path\to\agent.crt"
$env:AGENT_AIP_MTLS_KEY_FILE = "D:\path\to\agent.key"
$env:AGENT_AIP_CA_FILE = "D:\path\to\ca.crt"
```

客户端证书和私钥必须成对提供。未获发真实 AIC/CAI 或证书时，不要填写虚构值；仅 HTTPS 的远端若不要求 mTLS，可以不设置证书变量。环境变量只对当前 PowerShell 进程及其子进程生效。

## 独立 Agent 的 AIP 数据契约

本机模拟防守结果按提交内容中的文本证据匹配，不以攻击方声明的类型直接判定。每个命中包含规则编号、来源字段、匹配方式、依据和命中片段；风险是条件性推断，处置项是验证建议，并标明真实目标尚未验证、没有修改目标系统。

项目自带的本机 Agent 使用确定性规则生成**模拟测试用例**，例如多租户归属校验、越权指令和 SQL 参数拼接风险。样本会附带场景、检查目标和模拟标记；防守结果会列出命中依据和处置建议。Agent 不会发起真实网络攻击、访问客户数据、调用外部模型或执行数据库语句。`ACP/AIP` 只说明服务间的调用协议，不能据此判断结果来自真实模型或线上安全事件。

模拟分析会在战局详情标注为本地模拟规则；没有接入真实系统遥测、业务日志或外部分析模型前，不应把这些战局用作线上事件记录或检测率评估。

调用方通过 SDK 发送 AIP v2 `Start` 命令，用户输入放在 `TextDataItem.text`，内容是 UTF-8 JSON：

攻击 Agent 输入：

```json
{"difficulty":"mid","topic":"提示注入"}
```

攻击 Agent 必须在 `TaskResult.products[].dataItems[]` 中返回 `StructuredDataItem.data`：

```json
{"samples":[{"type":"violation","topic":"提示注入","severity":"medium","content":"..."}]}
```

防守 Agent 每个样本单独调用，输入：

```json
{"sample":{"type":"violation","topic":"提示注入","severity":"medium","content":"..."}}
```

防守 Agent 返回：

```json
{"caught":[],"risks":[],"fixed":[]}
```

三个防守字段及攻击方 `samples` 均必须是对象数组。AIP 任务失败、拒绝或未提供符合格式的结构化输出时，后端会将战局标记为失败。上述契约以本项目已安装的 `acps-sdk 2.1.0` 模型和客户端实现为准；不同平台的扩展字段需与队友另行对齐。

## 验收

1. 分别请求两个 Agent 的 `/health`（若其提供该接口），确认 URL 从后端主机可访问。
2. 配置至少一个远端角色并重启后端。
3. 调用 `POST /battles?background=true` 创建战局，轮询 `GET /battles/{id}` 至完成。
4. 调用 `GET /battles/{id}/events`，确认攻击样本和逐轮检测事件包含 `attackerSource` / `defenderSource: "acp"`；后台应显示“独立 ACP Agent”。
5. 检查后端日志和战报，确认没有协议错误或超时。

目前未配置任何独立 Agent URL、真实 AIC 或 mTLS 证书，因此代码和模拟测试通过不等于真实远端已连通。要完成端到端验收，需要取得攻击 Agent `/rpc`、防守 Agent `/rpc` 地址，以及平台要求的真实身份与证书材料。
