# 攻击 Agent 输出契约

```json
{
  "samples": [
    {
      "type": "defect|violation|vuln",
      "topic": "主题",
      "difficulty": "low|mid|high",
      "severity": "low|medium|high",
      "scenario": "场景说明",
      "objective": "检查目标",
      "content": "合成测试文本",
      "simulation": true
    }
  ]
}
```

当模型生成失败时，调用方应明确标注规则兜底来源，不得伪装成模型结果。
