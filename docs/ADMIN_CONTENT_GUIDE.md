# 管理后台内容说明（ADMIN_CONTENT_GUIDE）

更新时间：2026-10-24

面向接手 `/admin` 后台但读不懂页面内容的开发者。看完这一篇，应该能回答：这个后台在干什么、页面上每个数字从哪来、为什么大部分战局显示"未判定"。

---

## 一、一句话定位

这个后台是**智能体攻防演练的复盘台**，不是业务运营台。

一场"战局"= 让攻击 Agent 和防守 Agent 跑一次对抗，把全过程记成事件流，结束后给出裁决和双向评分。后台的作用是把这条记录**重放 + 取证**，所以页面看起来像日志，不像业务数据。

---

## 二、名词表

| 名词 | 含义 | 代码位置 |
|---|---|---|
| 战局 battle | 一次完整的攻防演练记录 | `battles` 表 / `BattleRecord` |
| 回合 round | 一轮「一个攻击样本 ↔ 一次防守检测」 | `round` 字段（1..N） |
| 样本 sample | 攻击 Agent 生成的 payload | `attackerOut.samples[]` |
| caught | 防守方命中的规则条目 | `defenderOut[].caught` |
| risks | 防守方识别出的风险项 | `defenderOut[].risks` |
| fixed | 防守方给出的修复建议 | `defenderOut[].fixed` |
| verdict | 裁决三态：`attacker_won` / `defender_won` / `undetermined` | `battles.verdict` |
| verificationMode | 验证方式：`off` / `simulated` / `live` | `AGENT_TARGET_VERIFY_MODE` |
| simulated | 标记"这条沦陷证据是模拟的，不是真实打穿" | 事件 `data.simulated` |

---

## 三、数据流

```mermaid
flowchart LR
  A[创建战局<br/>主题/难度/回合数] --> B[攻击 Agent<br/>每轮一条样本]
  B --> C[防守 Agent<br/>逐轮检测]
  C --> D[事件落库<br/>18 种事件]
  D --> E[裁决 + 双向评分]
  E --> F[后台呈现<br/>3D 回放/回合表/评分]
```

---

## 四、页面模块 ← 接口 ← 字段

| 页面模块 | 接口 | 关键字段 |
|---|---|---|
| 战局结论卡 | `GET /battles/{id}` + `battle.completed` 事件 + `GET /battles/{id}/rounds` | `verdict`、`compromisedRounds`、`interceptedRounds`、`verificationMode`、`stats` |
| 回合明细表 | `GET /battles/{id}/rounds` | `rounds[].round/status/sample/caught/risks/fixed/durationMs/compromised/arbiterReview` |
| 评分卡 | `GET /battles/{id}/score` | `attacker/defender.score`、`categories[].label/score/maxScore` |
| 事件时间线 | `GET /battles/{id}/events` | `sequence`、`type`、`data.round`、`data.durationMs` |
| 事件链完整性 | `GET /battles/{id}/audit` | `valid`、`issueCount`、`issues[].code` |
| 原始数据 | 上述接口原样返回 | 仅排查用，默认折叠 |
| 运行指标 | `GET /metrics`、`GET /dashboard/summary` | 按 5 组中文卡片展示：战局概况 / 攻防效果 / 服务运行 / 限流与防护 / 智能体调用（ACP） |
| 外部案例 | `GET /external-cases` | CVE / 厂商 / 产品（只读） |

`/rounds` 里 `total` 是**实际产出**轮数，`requestedRounds` 是**请求**轮数，两者可能不等（例如中途失败）。页面上会明确分开显示。

回合明细表最后一列是**独立裁决**（`arbiterReview`），它是 arbiter 在目标验证之后对本轮做的第二意见，**不改变**「本轮结果」列：

| 字段 | 含义 |
|---|---|
| `verdict` | `attacker_won` / `defender_won` / `undetermined` |
| `agentSource` | `arbiter-llm`（调用了模型）或 `arbiter-rule-fallback`（未开模型，纯规则） |
| `needsHumanReview` | 为 true 时页面显示「· 需复核」 |
| `rationale` / `evidence` | 悬停可见；`evidence` 必须是样本原文片段 |

没有验证证据时 arbiter 只会给 `undetermined`，这是设计上的保守约束，不是异常。

---

## 五、颜色语义

| 颜色 | 含义 | 出现位置 |
|---|---|---|
| 绿 `#36C98E` | 已拦截 / 防守成功 | 回合表、3D 屏障、结论卡 |
| 橙 `#F39C12` | 穿透但无验证证据 | 回合表、3D 数据包 |
| 红 `#ff435f` | 已验证沦陷（`targetVerified: true`） | 回合表、3D 节点、结论卡 |
| 灰 | 未判定 / 未开始 / 无证据 | 结论卡、3D 总结 |

**铁律：红色只给有 `targetVerified` 证据的沦陷。** 没有验证证据时永远不会显示红色 —— 这是刻意的保守设计。

---

## 六、四个常见疑问

**1. 为什么以前大部分战局显示"结果未判定"？**
`AGENT_TARGET_VERIFY_MODE` 默认是 `off`，`live` 又没有真实目标适配器，`verify_round` 只返回 `verification_disabled` 或 `no_live_adapter`，`aggregate_verdict` 拿不到证据就是 `undetermined`。这是"没有证据不下结论"的保守默认。
生产环境现已改为 `simulated`，由内置模拟靶标给出可复核的结论（见下条）；只有样本既没被防守命中、又不构成越权时才继续留在"未判定"。

**2. "模拟验证"是什么意思？**
`simulated` 模式跑的是进程内模拟靶标，判定规则只有两条：
- 防守报出命中 → 视为**拦截成立**（`simulated_target_blocked`）；
- 样本同时出现"身份伪装 + 敏感动作 + 绕过流程"三类信号 → 视为**模拟目标接受了越权指令**（`simulated_target_success`），并附样本原文片段作为证据。
其余情况（例如正常业务咨询）保持未判定、要求人工复核。所有模拟结论都强制带 `simulated: true`，含义是"模拟靶标这么判"，**不是**"真实系统真的失守"；前端会同时标注"真实目标未验证"。

**3. 为什么评分显示"证据不足"而不是 0 分？**
缺某个角色的 Agent 调用事件时，该角色返回 `score: null` + `status: insufficient_evidence`。把缺证当 0 分会造成"没跑等于做错"的误判，所以刻意返回 `null`。

**4. 两套评分是什么关系？**
- `frontend-v1`（前台模型）：综合分 = 基础攻防分 × 0.95 + 响应分 × 0.05。
- `internal-agent-v2`（历史）：攻 5 项 / 防 6 项，各 100 分。

两套**独立、不合并成单一胜负分**。后台按 `score.version` 显示当前适用版本。

---

## 七、审计问题 code 对照

| code | 中文 | 影响 |
|---|---|---|
| `non_contiguous_sequence` | 事件序号不连续 | 回放顺序可能错乱 |
| `duplicate_event_id` | 事件 ID 重复 | 去重逻辑异常 |
| `event_battle_mismatch` | 事件归属战局不一致 | 事件串场，数据污染 |
| `missing_battle_created` | 时间线缺少开始事件 | 记录不完整 |
| `missing_battle_completed` | 时间线缺少结束事件 | 战局未正常收尾 |
| `attacker_source_mismatch` | 攻击来源未留痕 | 无法证明走的是哪条调用链 |
| `defender_source_mismatch` | 防守来源未留痕 | 同上 |

`valid: true` 表示事件链自洽；`false` 时按 `issues[]` 逐条排查，不要直接改库。

---

## 八、排障入口

| 地址 | 用途 |
|---|---|
| `/admin` | 本后台（React） |
| `/dashboard` | 后端自带的简版中文页面（FastAPI 直出） |
| `/docs` | OpenAPI 接口文档，查字段最快 |
| `/metrics` | 原始运行指标 JSON |

排查顺序建议：先看结论卡有没有 `verdict` → 再看回合表有没有 `rounds` → 最后才展开「原始数据」。

指标区只展示中文字段卡片，不再渲染原始 JSON：需要对照字段时直接打开 `/metrics`。
