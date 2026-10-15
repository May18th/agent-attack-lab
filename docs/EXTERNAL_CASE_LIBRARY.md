# 外部安全案例库

项目内的外部案例库用于查询和展示公开安全通告，不等同于本项目生成的攻击样本、战局或真实事件。

## 数据边界

- 数据来源包括 CISA 官方 Known Exploited Vulnerabilities (KEV) JSON 和 NVD 官方 CVE API 2.0。
- 每个来源保留发布版本、发布时间、抓取时间、原始内容 SHA-256 和来源 URL。
- NVD 导入记录对应明确的 CVE 发布时间窗口和 NVD 快照时间；默认不需要 API key，按官方未认证请求速率分页。
- 跨来源按 CVE ID 去重展示；同一 CVE 同时存在时优先展示 CISA KEV 记录，其他来源记录仍保留供审计。
- 导入记录默认标记为 `provenanceStatus=verified_primary`、`recordKind=external_fact`、`synthetic=0`。
- NVD 标记为 `Rejected` 的记录不作为有效案例导入。
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

导入 NVD 指定发布时间窗口（开始和结束时间必须带时区，窗口最长 120 天）：

```powershell
uv run python scripts/import_external_cases.py --source nvd `
  --start-date "2026-10-01T00:00:00Z" `
  --end-date "2026-10-15T00:00:00Z"
```

生产案例库与本地案例库是独立文件；导入本机 SQLite 不会自动更新公网数据。导入前应备份目标数据库，导入后运行
`uv run python scripts/import_external_cases.py --validate` 并抽查来源、CVE 去重和样本类型。

报告中的 `added`、`removed` 和 `changed` 只表示目录记录差异；人工确认发布版本、来源 URL 和内容哈希后，才能执行导入。

截至 2026-10-15，本机 CISA KEV 已刷新到目录版本 `2026.10.14`，查询层按 CVE 去重后为 1,745 条；NVD 接入代码和测试已完成，但当前网络请求 NVD API 超时，尚未导入 NVD 数据。生产环境需在 SSH 恢复后单独执行导入和验收。

校验失败时先保留数据库和报告，禁止直接改写来源字段来消除错误。新增来源前应确认发布方、一手 URL、版本和哈希，并补充对应测试。
