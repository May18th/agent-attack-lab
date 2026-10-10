# 微调数据清洗记录（2026-10-10）

## 处理边界

- 原始目录：`artifacts/finetune/`，保留不动。
- 清洗目录：`artifacts/finetune_clean/`，由 `backend/scripts/clean_finetune_dataset.py` 生成。
- 清洗仅在本地执行；未上传 Git、VPS 或训练平台，未调用模型，未启动训练。

## 清洗规则

按 `metadata.topic` 成组剔除明显联调、评委、占位和随机噪声，攻击与防守样本同步剔除：

- `完全无关的随机主题abc`
- `验收A-...`、`验收A4复查`、`验收B-...`
- `评委实测desktop`、`评委实测mobile`
- `LLM连接自测-...`
- `公网联调`
- `general`

保留“公网接入前的本地链路验证”，因为它是具体的安全验证场景，不是泛化联调占位主题。

## 结果

| 项目 | 数量 |
|---|---:|
| 原始样本 | 105 |
| 清洗后样本 | 72 |
| 剔除样本 | 33 |
| attacker train / validation | 15 / 19 |
| defender train / validation | 20 / 18 |

剔除原因统计：

| 原因 | 数量 |
|---|---:|
| acceptance-run | 10 |
| jury-run | 8 |
| public-integration-run | 9 |
| random-topic | 2 |
| llm-connectivity-test | 2 |
| placeholder-topic | 2 |

清洗后的 6 个保留主题为：通用安全测试、电商支付接口越权测试、订单查询权限校验、儿童教育陪伴机器人的越狱诱导、智能简历筛选系统的偏见注入攻击、公网接入前的本地链路验证。

## 验证

- 清洗脚本对输入执行结构和 evidence 校验，异常数据 fail-closed。
- 清洗后文件生成独立 `manifest.json`，记录数量、剔除原因和 SHA-256。
- 原始数据仍可用于追溯；清洗结果只作为后续人工审核候选集。
- 清洗后复核未发现字段缺失、evidence 不匹配或 sourceBattle 跨训练/验证集合泄漏。
- 难度分布仍不均衡：攻击样本为 `low=1`、`mid=24`、`high=9`；防守样本为 `low=8`、`medium=24`、`high=6`。这属于覆盖面风险，不是格式脏数据。

## 队友审核重点

请确认上述主题过滤是否符合训练目标，尤其是是否需要恢复 `公网联调` 或某些 `验收` 样本；同时决定是否补充 low 难度样本以改善平衡。未确认前不要上传清洗集或启动训练。
