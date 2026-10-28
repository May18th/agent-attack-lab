# 后端知识库盘点

## 已有实现（接入前）

| 位置 | 当前内容 | 结论 |
|---|---|---|
| `backend/src/agent_attack_lab/agent_logic.py` | 内置确定性攻击样本生成与规则防守逻辑 | 可运行的演示库，不是版本化知识库 |
| `backend/src/agent_attack_lab/owasp_rules.py` | OWASP LLM 分类和本地检测规则 | Defender 的代码内置规则，保留为运行时兜底 |
| `backend/src/agent_attack_lab/storage.py` | `admin_samples`、`admin_rules` 两张管理员表 | 已有数据库库，但缺少角色投影、版本状态和发布审核字段 |
| `backend/src/agent_attack_lab/agents/knowledge.py` | Attacker/Defender 提示词字段投影、长度和数量限制 | 已有安全边界适配器，不负责持久化 |
| `backend/src/agent_attack_lab/external_cases.py` | CISA/NVD 只读外部案例库 | 外部参考库，不作为攻防 Agent 正式规则库 |
| `backend/src/agent_attack_lab/agents/rule_discovery.py` | 人工复核后的规则候选生成 | 候选结果，不会自动发布 |

## 本次补充

新增 `backend/data/libraries/{common,attacker,defender,arbiter}/catalog.json`，以及
`backend/src/agent_attack_lab/library_store.py`。已按样本计划生成一批静态、合成、隔离
测试记录：common 11 条、attacker 76 条、defender 19 条；全部记录均为 `candidate`，
带有 `version/status/createdBy/reviewedBy` 元数据，不会直接进入 Agent 的批准上下文。
Arbiter 目录仍保留为空，等待后续根据评分细则补充裁决和安全对照样本。

新增内部读取接口：

```text
GET /internal/library/catalog
GET /internal/library/attacker/context
GET /internal/library/attacker/samples
GET /internal/library/attacker/strategies
GET /internal/library/defender/context
GET /internal/library/defender/rules
GET /internal/library/defender/features
GET /internal/library/defender/tools
GET /internal/library/public-feedback
```

接口默认只返回库和记录均为 `approved` 的记录，审核工具可显式读取 `candidate` 记录；要求后端 API Key（本地未配置密钥时按现有开发策略放行）。Arbiter 目录只可通过后端库适配器读取，不能由 Agent 读取。

Attacker 和 Defender 独立进程在未收到外部 `_knowledgeContext` 时，会自动读取各自的批准库上下文；现有调用的请求、响应和后端 API 不变。

主战局编排器也会把已批准种子记录与现有 `admin_samples` / `admin_rules` 做同角色合并，再经过 `agents/knowledge.py` 的字段投影后传给对应 Agent。旧管理员表因此继续可用，未来迁移到版本化目录时不需要改 Agent 请求契约。
