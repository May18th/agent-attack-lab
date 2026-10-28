# 03 调用链与模式边界（覆盖清单第 5、6、8、10 项）

> 数据来源：生产环境公开接口 `GET /battles`、`GET /battles/{id}`，采集于 2026-10-28 13:55（UTC+8）。
> 原始响应：`raw/battles-list.json`、`raw/battle-A-08x.json`（A-083 ~ A-087 五场）。

## 一、三路来源在同一战局内可查（第 5、6 项）

每场战局详情里，攻击、防守、裁决三路各自带 `agentSource`，并用同一个 `battleId` 串起来。
这里的 `battleId` 就是清单要求的**关联 ID**，`testCaseId` 是样本级关联 ID。

| 战局 | 时间(UTC) | 难度/轮次 | 攻击来源 | 防守来源 | 裁决来源 | 裁决结果 |
|---|---|---|---|---|---|---|
| A-083 | 05:05:15 | mid / 3 | `acp-llm` | `acp-llm` | `arbiter-llm` | undetermined |
| A-084 | 05:38:24 | low / 5 | `acp-llm` | `acp-llm` | `arbiter-llm` | undetermined |
| A-085 | 05:51:49 | low / 5 | `acp-llm` | **`acp-rule-fallback`** | `arbiter-llm` | undetermined |
| A-086 | 05:52:50 | low / 5 | `acp-llm` | `acp-llm` | `arbiter-llm` | undetermined |
| A-087 | 05:53:29 | low / 5 | `acp-llm` | **`acp-rule-fallback`** | `arbiter-llm` | undetermined |

字段级证据（A-087 原文，未改写）：

```json
{
  "attackerOut.agentSource": "acp-llm",
  "defenderOut[0].agentSource": "acp-rule-fallback",
  "defenderOut[0].arbiterReview.agentSource": "arbiter-llm",
  "defenderOut[0].arbiterReview.verdict": "undetermined",
  "defenderOut[0].arbiterReview.needsHumanReview": true
}
```

**能说明什么**：三路确实由不同执行体产出，来源字段不是写死的常量（同一批战局里防守来源有 `acp-llm`
与 `acp-rule-fallback` 两种取值），且都能回指同一个战局。

**不能说明什么**：这是**我们内部**的三路调用链，不是平台发起的调用。平台→我们的入站链路
未打通（见 `PLATFORM_ACCESS_DATA_20261028.md`），材料里不能拿这批数据说成"平台侧双向调用"。

## 二、规则模式降级是运行时真实发生的（第 8 项）

A-085 与 A-087 的防守走的是 `local-rule-fallback`，且 `analysisMode` 自述为：

> 本地 OWASP LLM Top 10 (2025) 文本规则分析；只检查提交的样本文本，不代表真实目标已验证

这说明：模型不可用时，防守侧会退到**本地规则**继续出结论，而不是报错或伪造结果。
同批战局里 A-083/084/086 仍是 `acp-llm`，两种模式在同一时间段内并存，属于真实降级而非预先摆拍。

**仍缺的一步**：清单要的是"无外部模型 API Key 的完整演示证据"。当前证据是"降级确实会发生"，
还差一次**主动置空 Key 后从头跑一局**的记录。补齐方式：
置空 `AGENT_LLM_API_KEY` 重启服务 → 新建一局 → 截图战局详情里防守来源为 `acp-rule-fallback`
且 `scopeNotice` 含"未调用外部模型"。约 10 分钟。

## 三、边界口径写在返回体里（第 10 项）

系统不是靠文档声明边界，而是每次返回都带自证字段：

| 字段 | 取值样例 | 作用 |
|---|---|---|
| `scopeNotice` | 模型模式：`仅提交样本文本给配置的模型；未请求真实业务接口、未访问数据库或执行工具。`<br>规则模式：`未请求真实业务接口、未访问数据库、未调用外部模型；处置项仅为建议。` | 明确这一局的结论覆盖到哪 |
| `verificationStatus` | `大模型分类 1 条文本线索；真实目标未验证` / `未命中当前本地规则；真实目标未验证` | 区分"模型判断"与"真实目标验证" |
| `samples[].simulation` | 五场全部 `true` | 样本是模拟生成，不是对真实系统打的 |
| `arbiterReview.needsHumanReview` | 五场全部 `true` | 结论需人工复核，不自动定胜负 |

**因此**：五场裁决都是 `undetermined` 不是缺陷，是边界设计的直接结果——没有真实目标验证，
就不给"防守成功/被攻破"的判定。材料里应正面写这一点，不要为了好看改成"防守成功"。

## 四、三种模式的定义（对应清单 off / simulated / live）

| 模式 | 触发条件 | 运行时特征 | 当前状态 |
|---|---|---|---|
| **off**（关闭） | 验证开关关闭 | `verificationStatus` 含"真实目标未验证"；`scopeNotice` 声明未请求真实接口 | 五场战局均为此态 |
| **simulated**（模拟） | 样本 `simulation: true` | 只对样本文本做模型/规则判断 | 五场战局均为此态 |
| **live**（真实） | 配置真实目标 adapter 并开启验证 | 会请求真实业务接口 | **当前未启用**，无 live 记录 |

`target_verify.py` 是 live 模式的入口，默认关闭。材料里凡涉及"真实目标"的表述，
都必须标明"当前未启用真实目标 adapter"，否则就等于把 simulated 冒充 live。
