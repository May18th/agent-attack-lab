# 战局完整性审计

`GET /battles/{battle_id}/audit` 是只读审计接口，不修改战局或事件记录。

当前检查：

- 事件序列是否从 1 连续递增；
- 事件 ID 是否重复；
- 每个事件是否属于目标战局；
- 事件是否有状态；
- 已完成战局是否以 `battle.created` 开始并以 `battle.completed` 结束；
- 战局结果中的 `agentSource` 是否在事件中留下相同来源。

审计失败只说明记录需要复核，不会自动删除、修复或重写任何数据。

接口示例：

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/battles/<battle-id>/audit"
```
