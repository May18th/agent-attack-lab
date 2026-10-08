# 防守 Agent 输出契约

```json
{
  "caught": [
    {
      "ruleId": "OWASP-LLM01-LOCAL",
      "owaspCategory": "LLM01",
      "matchedText": ["输入中的连续原文"],
      "matchMethod": "原文连续片段校验"
    }
  ],
  "risks": [
    {
      "level": "medium",
      "reason": "条件性风险说明",
      "basis": "仅依据提交文本，真实目标未验证"
    }
  ],
  "fixed": [
    {
      "action": "隔离环境验证建议",
      "status": "建议验证；未修改目标系统"
    }
  ],
  "scopeNotice": "仅分析提交的合成文本，真实目标未验证"
}
```

`sampleCount`、规则命中数和风险记录必须按实际数据分别计数，不得用同一个样本数填充所有统计卡。
