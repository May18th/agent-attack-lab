# 演示视频脚本（3–4 分钟，可复现）

更新时间：2026-10-25 23:59
配套证据：[`TECH_EVIDENCE_PACK.md`](TECH_EVIDENCE_PACK.md)
用途：录屏者照着念、照着点即可，不需要理解代码。

---

## 一、演示定位

一条视频要回答三个问题，按顺序讲，不要插叙：

1. **这是什么** —— 一个在梧桐平台上可被发现、可被调用的多智能体攻防系统。
2. **怎么互联** —— 三个智能体经 AIP JSON-RPC + mTLS 互联，由 Leader 编排。
3. **效果如何** —— 一场真实战局，攻防仲裁全部由模型产出，全链路可追溯。

---

## 二、演示环境：**用公网，不用本机**

| 项 | 选择 | 原因 |
|---|---|---|
| 业务入口 | `https://api.yuanyiagentzhandui.cn` | 生产常驻，与本机开关机无关 |
| 平台侧 | `https://wt.ioa.pub` | 评委自己也在用的入口，可信度最高 |
| 本机服务 | **不需要启动** | 心跳已由 VPS 独立上报（实测：本机零进程时平台仍 3 条在线） |

> 录屏时**故意不启动本机服务**，这本身就是一条证据：平台上三只在线，而演示笔记本上没有跑任何相关进程。

---

## 三、录屏前 10 分钟检查表

按顺序做，任何一项不通过就不要开录。

| # | 检查 | 命令 / 操作 | 通过标准 |
|---|---|---|---|
| 1 | 公网服务活着 | `curl.exe -s -o NUL -w "%{http_code}" https://api.yuanyiagentzhandui.cn/health` | `200` |
| 2 | 平台三只在线 | 见 §3.1 | 恰好 **3 条**，名称齐全 |
| 3 | 本机无相关进程 | 任务管理器搜 `python`，或见 §3.2 | 无 `agent_attack_lab` / `run_amp_heartbeat` |
| 4 | 后台能登录 | 浏览器打开 `https://api.yuanyiagentzhandui.cn/dashboard` | 出现登录页并能登录成功 |
| 5 | 清掉探测战局 | 登录后台删除标题含"探测""验证"的旧战局 | 列表首屏无测试标题 |
| 6 | 浏览器窗口干净 | 关闭无关标签、隐藏书签栏、缩放 100% | — |
| 7 | 网络稳定 | 打开平台首页确认可访问 | 页面正常渲染 |

### 3.1 查平台在线（PowerShell，可直接复制）

```powershell
curl.exe -s --noproxy "*" -X POST https://wt.ioa.pub/discovery/acps-adp-v2/discover `
  -H "Content-Type: application/json" `
  -d "{\"type\":\"filtered\",\"limit\":10,\"filter\":{\"conditions\":[{\"field\":\"name\",\"op\":\"contains\",\"value\":\"智能体攻防实验室\"}]}}"
```

判定：返回里的 `acsMap` **恰好 3 个键**。多于 3 说明旧 AIC 还没过期，**等 3 分钟再查**（实测摘除延迟 2–3 分钟）。

当前应出现的三个 AIC 尾号：主调度 `0U7Q`、攻击 `0MVE`、防守 `0GFQ`。
若出现 `09CQ` / `08RN` / `09SG` / `S5AJC0` / `QY650M`，说明是历史轮次残留，等过期即可。

### 3.2 确认本机没在跑

```powershell
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -like '*agent_attack_lab*' -or $_.CommandLine -like '*run_amp_heartbeat*' } |
  Select-Object ProcessId, CommandLine
```

期望：**无输出**。有输出就 `Stop-Process -Id <PID> -Force`，然后等 3 分钟再查平台。

---

## 四、分镜脚本

固定参数，不要临场改：

- 主题：`客服机器人泄露内部系统提示词`
- 难度：`high`
- 轮数：`3`

| 时间 | 画面 | 操作 | 口播要点 |
|---|---|---|---|
| 0:00–0:20 | 架构图（见 `docs/ARCHITECTURE.svg`） | 全屏展示 | 三个智能体：1 个 Leader 编排 + 攻击、防守各 1 个 Partner，经 AIP 互联，跑在梧桐平台上 |
| 0:20–0:55 | 平台首页 → 名称搜索"智能体攻防实验室" | 输入名称，回车 | 三只都在线；说明存活来自 AMP 心跳，由云端常驻服务上报，**不是这台笔记本** |
| 0:55–1:15 | 切"最新智能体"列表 | 点最新列表 | 三只都排在最近上榜里（1.2.0 重新注册后已进榜） |
| 1:15–1:35 | `https://api.yuanyiagentzhandui.cn/docs` | 展开 `/rpc` 与 `/battles` | AIP JSON-RPC 2.0 接口，mTLS 双向认证；接口全公开可查 |
| 1:35–2:20 | 创建战局 → 战局详情 | 见 §5.1、§5.2 | 提出测试主题，Leader 先调攻击智能体生成合成样本，再逐条调防守智能体检测 |
| 2:20–2:50 | 详情 JSON 的 `agentSource` 字段 | 高亮四个字段 | 四次模型调用分别落在攻击、防守、仲裁、战报，字段名与取值都在屏幕上 |
| 2:50–3:15 | 战报页（`/dashboard` 内） | 打开战报 | 结论 + 风险等级 + 修复建议，摘要由模型生成 |
| 3:15–3:40 | correlationId 追溯 | 见 §5.3 | 同一次战局的每次调用共用一条调用链，可逐跳核对，不靠日志口头保证 |
| 3:40–3:55 | 收尾 | 回架构图 | 模型不可用会退回确定性规则，战局仍能跑完；这是增强不是依赖 |

**总时长控制**：3 分 55 秒以内。超过 4 分钟就砍 0:55–1:15 那段列表展示。

---

## 五、关键步骤的精确操作与预期输出

### 5.1 创建战局

```powershell
curl.exe -s --noproxy "*" -X POST https://api.yuanyiagentzhandui.cn/battles `
  -H "Content-Type: application/json" `
  -d "{\"topic\":\"客服机器人泄露内部系统提示词\",\"difficulty\":\"high\",\"rounds\":3}"
```

预期：返回 `id`（形如 `battle-xxxxxxxx-...`）、`code`（形如 `A-010`）、`status=completed`。
**把 `id` 记下来**，后面两步要用。

> 耗时：3 轮约 30–90 秒（四路模型串行调用）。建议**提前录一次拿到 id**，正式录屏时用后台已完成的战局展示，避免录到长时间等待。
> 若坚持现场创建，请把等待段剪掉，或把它讲成"模型正在逐轮推理"。

### 5.2 看四路来源字段

把 `<ID>` 换成上一步的 `id`：

```powershell
curl.exe -s --noproxy "*" https://api.yuanyiagentzhandui.cn/battles/<ID>
```

画面里要能看清这四个取值（建议提前把 JSON 格式化后再打开，或用浏览器 JSON 插件）：

| 字段路径 | 期望值 | 含义 |
|---|---|---|
| `attackerOut.agentSource` | `acp-llm` | 攻击样本由模型生成，且是经 AIP 调到的 |
| `defenderOut[0].agentSource` | `acp-llm` | 防守经 AIP 调到 |
| `defenderOut[0].agentMode` | `llm` | 防守内部确实用了模型（不是自报规则） |
| `defenderOut[0].arbiterReview.agentSource` | `arbiter-llm` | 独立仲裁由模型裁决 |

战报摘要：

```powershell
curl.exe -s --noproxy "*" "https://api.yuanyiagentzhandui.cn/battles/<ID>/report?format=json"
```

看 `summary.agentSource` = `report-llm`。

### 5.3 correlationId 追溯

同一次战局的每次调用共用一条调用链，体现在 `/battles/<ID>` 的 `defenderOut[*].correlationId` 与 `attackerOut.correlationId` 上。

讲法建议：**"攻击生成、每条样本的防守检测、仲裁复核，各自有一次带 correlationId 的调用记录，可以按 ID 逐跳对上，不需要信我的日志。"**

不要讲成"全链路追踪系统"之类的大词，会被追问实现细节。

---

## 六、翻车兜底

| 情况 | 现场处理 |
|---|---|
| 平台显示 0 条或多于 3 条 | 不要现场排查。直接说"平台侧状态有缓存延迟，我这边服务侧是活的"，切到 `/health` 与 `/docs` 展示，继续往下录 |
| 创建战局超时 / 报错 | 改用**备份战局**：事先录好的一场，`A-009` 或重录前新建的一场，直接打开详情讲字段 |
| 某字段显示 `local-rule-fallback` / `arbiter-rule-fallback` | **不要说"模型失败"**。说"这是设计上的降级路径：模型不可用时退回确定性规则，战局照常完成"。这条要练熟，答辩也必问 |
| 后台登录失败 | 跳过战报页，用 `report?format=json` 的原始 JSON 代替，字段一样能说明问题 |
| 网络卡顿 | 提前把关键 JSON 用浏览器打开好，不要现场等 |

---

## 七、不要说的话

写材料、口播都适用。说了会被追问到答不上来。

| 不要说 | 为什么 | 可以说 |
|---|---|---|
| "已修复 N 个漏洞" | 系统做的是受控合成测试，没有对真实业务系统下结论 | "在受控样本上完成检出与裁决" |
| "检测准确率 XX%" | 没有标注数据集，算不出准确率 | "裁决要求证据门槛，无证据只能判 `undetermined`" |
| "全链路追踪系统" | 实际是 correlationId 贯穿调用 | "每次调用带 correlationId，可按 ID 逐跳核对" |
| "模型调用量 XX 次" | 没有平台侧计量数据 | 只说单场战局的四路来源字段 |
| "已接入 mTLS 对外认证" | 需与实际证书状态一致，别自己加码 | "生产侧按 AIP + mTLS 方案部署"，细节不清就只说 AIP JSON-RPC |
| "热门榜单上榜" | `trending` 按真实调用量，我们未上榜 | 只说"最新智能体列表可查到" |

---

## 八、录屏参数

- 分辨率 1920×1080，浏览器缩放 100%，关闭深色模式以外的干扰插件
- 光标速度放慢，点击后停 0.5 秒再动，方便后期加标注
- 旁白建议后录：先录屏，再对着画面配音，能显著减少口误
- 导出 MP4 / H.264，码率 ≥ 4 Mbps；文件大小控制在 200 MB 内便于上传
- **不要录到**：密码输入过程、任何 API key、终端里的 `.env` 内容

---

## 九、录完自检

- [ ] 四个来源字段在画面上至少各出现一次，且看得清
- [ ] 平台三只在线画面出现过
- [ ] 没有出现要求"猜"的技术名词（出现就在字幕里补一句解释）
- [ ] 全程没有说 §7 里的话
- [ ] 时长 ≤ 4 分钟
- [ ] 片中未出现探测战局标题、未出现密码与 key
