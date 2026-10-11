# 外部安全案例库

项目内的外部案例库用于查询和展示公开安全通告，不等同于本项目生成的攻击样本、战局或真实事件。

## 数据边界

- 当前导入脚本使用 CISA 官方 Known Exploited Vulnerabilities JSON。
- 每个来源保留发布版本、发布时间、抓取时间、原始内容 SHA-256 和来源 URL。
- 导入记录默认标记为 `provenanceStatus=verified_primary`、`recordKind=external_fact`、`synthetic=0`。
- 原始 JSON 保存在本地数据库中用于审计，但查询接口不会返回 `rawJson`，避免把整份原始载荷直接暴露给前端。
- 外部案例不能自动写入战局，也不能被展示为项目已经观察到的攻击或漏洞。

## 只读查询接口

接口：`GET /external-cases`

可用参数：

- `q`：按 CVE、标题、厂商或产品模糊检索。
- `vendor`：按厂商项目模糊筛选。
- `product`：按产品模糊筛选。
- `limit`：每页 1-200 条，默认 50。
- `offset`：分页偏移，默认 0。

示例：

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/external-cases?q=CVE-2024&limit=20"
```

响应中的 `items[*].source` 包含 `publisher`、`catalogVersion`、`releasedAt`、`retrievedAt` 和
`contentSha256`，前端应同时展示来源状态和来源 URL。`available=false` 只表示本机未导入数据库或数据库暂时不可读，不应伪造为空的“无案例”。

## 本地校验

```powershell
cd "D:\梧桐\backend"
uv run python scripts/import_external_cases.py --validate
```

比较远端新目录与本地最近一次导入快照，不修改数据库：

```powershell
uv run python scripts/compare_external_cases.py
```

报告中的 `added`、`removed` 和 `changed` 只表示目录记录差异；人工确认发布版本、来源 URL 和内容哈希后，才能执行导入。

校验失败时先保留数据库和报告，禁止直接改写来源字段来消除错误。新增来源前应确认发布方、一手 URL、版本和哈希，并补充对应测试。
