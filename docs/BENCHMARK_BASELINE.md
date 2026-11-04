# 双层防御基准对照结果（规则层 + 语义层 vs 公开注入样本集）

> 生成方式：`backend/scripts/benchmark_owasp_rules.py`（规则层）+ `benchmark_defender_semantic.py`（语义层，真实调用 DeepSeek）
> 生成时间：2026-11-04（数据经 `hf-mirror.com` 镜像拉取）
> 结果落盘：`backend/artifacts/benchmark/`（`owasp_rule_benchmark.json` + `defender_semantic_benchmark.json`）

## 一、测的是什么

本项目 Defender 有**两条独立路径**，本目录两个脚本分别测其中一条：

| 层 | 脚本 | 实现 | 依赖 |
|---|---|---|---|
| 规则层 | `benchmark_owasp_rules.py` | `owasp_rules.classify_owasp_llm_text`，确定性正则文本特征 | 无模型，离线 |
| 语义层 | `benchmark_defender_semantic.py` | `defender.py` → DeepSeek 分类，真实 API 调用 | `AGENT_LLM_*` 配置 |

两者都**不跑完整 Attacker/Defender/Arbiter 链路、不碰真实靶标**，只测"单条样本 → 是否判为注入"这一判定动作。完整端到端能力需另行评估，本目录数字不等价于平台整体检出率。

## 二、结果总览

数据集：`deepset/prompt-injections`（注入 60 / 良性 56）与 `Lakera/gandalf_ignore_instructions`（全注入，112 条）。

| 数据集 | 层 | 检出率 | 误报率 |
|---|---|---|---|
| gandalf（全注入） | 规则层 | 21.4%（24/112，确定值） | — |
| gandalf（全注入） | **语义层** | **85.7%–86.6%（96–97/112）** | — |
| deepset（注入60/良性56） | 规则层 | 0.0%（0/60，确定值） | 0.0%（0/56） |
| deepset（注入60/良性56） | **语义层** | **43.3%–46.7%（26–28/60）** | **0.0%（0/56）** |

> **重要**：规则层是确定性正则，结果可精确复现（单一数值）；语义层经真实
> DeepSeek 调用（`temperature=0.2`），同一批样本多次运行命中数有 ±2 条量级的
> 波动（见上表区间）。故语义层数字应读作**区间快照**，而非精确常数。

## 三、核心结论（真实、可复现）

1. **语义层全面强于规则层**：gandalf 检出率 21.4% → 约 86%，deepset 0% → 约 45%。
   说明"确定性文本特征"天花板明确，模型语义分类是真正扛检测的那一路。
2. **误报率在两层都是 0**：deepset 56 条良性，规则层和语义层均零误判。
   这符合 Defender "宁可漏报、不乱报"的防守兜底定位，也是可控误报的正面证据。
3. **双层互补成立**：规则层能零成本兜底显式指令注入（gandalf 显式子集命中 23/72），
   语义层补齐隐性角色扮演/语义越狱（deepset 里规则层 0 命中、语义层约 45%）。
   这正是"为什么需要双层防御"的数据实证。
4. **语义层仍非满分**：deepset 检出率约 45%、gandalf 漏 15–16 条，
   说明越狱变体仍有一部分未被当前 prompt 覆盖。这是**诚实的能力边界**，
   也是后续调 prompt / 换更强模型 / 加靶标验证的改进空间，不应掩盖。
5. **语义层结果有运行间波动**：因模型采样（temperature=0.2），同批样本多次运行
   命中数有 ±2 条波动。结论方向（语义层 ≫ 规则层、误报双 0）在多次运行间稳定，
   但**具体百分点不应对齐到个位精度**。

## 四、口径红线（对外引用必须遵守）

- 以上数字是**单条判定动作**的检出率，**不等于**平台端到端攻防的成功率。
- 两个脚本都是只读探针，未改动任何生产代码；语义层脚本真实调用 DeepSeek（有 API 成本）。
- gandalf 无良性集，其误报率记 `null`，禁止编造。
- **语义层数字是单次/数次运行的区间快照**，受模型采样影响有 ±2 条波动，不对齐到个位精度。
- 引用时**必须同时给出规则层与语义层两列**，禁止单独摘"约 86%"或"约 45%"当平台能力宣传。

## 五、复现命令

```bash
cd backend
# 规则层（离线，秒级）
HF_ENDPOINT=https://hf-mirror.com .venv/Scripts/python.exe scripts/benchmark_owasp_rules.py

# 语义层（真实调 DeepSeek，约 2 分钟；先用 BENCH_MAX_SAMPLES=8 试跑）
BENCH_CONCURRENCY=6 HF_ENDPOINT=https://hf-mirror.com \
  .venv/Scripts/python.exe scripts/benchmark_defender_semantic.py
```
