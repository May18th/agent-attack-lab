# 微调数据准备流水线

本项目的攻击/防守 Agent 使用梧桐（wit）负责运行时和协作协议；wit 本身不是训练平台。`backend/scripts/prepare_finetune_dataset.py` 只负责把已完成战局中的合成样本整理成 provider-neutral 的 chat JSONL，供后续经过人工审核的训练平台使用。

## 导出

在后端目录运行：

```powershell
cd "D:\梧桐\backend"
uv run python scripts\prepare_finetune_dataset.py --database .data\battles.sqlite3
```

默认输出到仓库根目录的 `artifacts/finetune/`：

- `attacker_train.jsonl` / `attacker_validation.jsonl`
- `defender_train.jsonl` / `defender_validation.jsonl`
- `manifest.json`（数量、固定拆分种子和 SHA-256）

导出只读取 `completed` 战局，自动去重，并按 `topic` 与 `difficulty` 分组拆分，避免同一组样本在训练集和验证集之间随机漂移。防守样本的 `evidence` 只接受输入 `content` 中的连续原文；不符合的模型结果会被导出为空 findings，而不会把改写后的证据伪装成原文。

## 审核边界

导出的内容明确标记为合成、静态、不可执行的实验样本。上传训练平台前必须人工检查：删除敏感信息、确认授权范围、检查攻击样本不会指向真实目标，并确认防守标签与证据一致。脚本不会读取模型 API Key、不会调用模型、不会上传文件，也不会启动训练任务。

## 接入训练平台

当前仓库没有已授权的训练平台账号或训练 API 凭据，因此不能在本地替用户创建付费训练任务。训练平台完成训练并提供 OpenAI-compatible 推理端点后，运行时只需配置：

```dotenv
AGENT_LLM_BASE_URL=https://<approved-model-endpoint>/v1
AGENT_LLM_MODEL=<fine-tuned-model-id>
AGENT_LLM_API_KEY=<local-secret>
```

不要恢复或配置 DeepSeek。接入后仍需运行现有 Agent 输出 schema、证据精确匹配和规则降级测试，再用隔离样本验收 `acp-llm` 来源。
