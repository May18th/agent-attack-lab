# 07 样本库 / 规则库与审计日志（对应第二项整改）

> 背景：评审反馈"样本库和规则库都是空的，审计日志完全看不懂"。
> 排查结论：**库不是空，是"有数据但用不上"；审计不是排版差，是噪声盖住了业务记录。**
> 数据采集：2026-10-28 22:20（UTC+8），线上 `https://yuanyiagentzhandui.cn`。

## 一、样本库 / 规则库

### 1.1 现状

| 项 | 数量 | 查看位置 |
|---|---|---|
| 攻击样本 | **20 条** | 后台 → 管理 → 样本库（`11/13-sample-library.png`） |
| 防守规则 | **12 条** | 后台 → 管理 → 规则库（`15-rule-library.png`） |
| 覆盖主题 | 13 个（提示注入、系统提示词泄露、间接注入、工具越权、支付越权、报销绕过、文件上传穿越、供应链投毒、招聘歧视、内容审核绕过等） | `backend/src/agent_attack_lab/library_seed.py` |

补齐方式：后台"载入内置示例"（`POST /admin/library/seed`），**幂等**，已存在的不重复插入。
线上实测返回：新增样本 14 条（跳过 6）、新增规则 5 条（跳过 7）。

### 1.2 真正的问题：匹配算法空转

原实现只做"主题互相包含"判断（`record.topic in topic`）。实际战局主题换个说法就命中 0 条：

| 战局主题 | 库里样本主题 | 旧逻辑命中 |
|---|---|---|
| AI 客服被诱导泄露**客户手机号与证件号** | AI 客服被诱导泄露**用户隐私** | **0 条**（不是子串） |

命中 0 条时攻击方拿到的知识上下文是空的 —— 库里有多少条都一样，这就是反馈里"库是空的"的观感来源。

### 1.3 现在的做法

- 按领域关键词求交集打分，同义主题也能命中，按相关度排序取前 8 条；
- 没有写主题的通用规则作为兜底，不会被相关度排序挤掉；
- 攻击方只看到样本（不含防守规则），防守方只看到规则（不含样本），两侧信息仍然隔离。

实测（同一份种子库，6 个常见主题）：

| 战局主题 | 命中样本 | 命中规则 |
|---|---|---|
| AI 客服被诱导泄露客户手机号与证件号 | 6 | 8 |
| AI 客服被诱导泄露用户隐私 | 4 | 8 |
| 间接提示注入：检索文档中夹带外传指令 | 5 | 8 |
| 系统提示词套取与内部口令核对 | 3 | 8 |
| 支付越权：订单归属与退款 | 7 | 8 |
| 金融客服被诱导修改账户权限 | 5 | 8 |

回归测试：`backend/tests/test_llm_knowledge.py`
（含"换个说法要能命中""不相关主题不许拉进来""更相关排更前"三条）。

## 二、审计日志

### 2.1 问题是噪声

中间件把每个 HTTP 请求都写成一条 `http.request` 事件。默认视图里 200 条记录有 166 条是
`GET /admin/samples → 200` 这类流水，真正的战局、样本、规则操作被压在下面。

### 2.2 改法

| 改动 | 位置 | 效果 |
|---|---|---|
| 默认不返回接口流水 | `storage.list_audit_events_filtered(include_http=False)` | 默认 113 条全是业务事件 |
| 需要排查时显式开启 | 后台"包含接口调用记录"复选框 → `include_http=true` | 返回 200 条（上限），含 166 条接口流水 |
| 事件摘要写成人话 | `AdminManagementPanel.auditSummary()` | 见下表 |
| 角色列补中文 | `adminLabels.ACTOR_LABELS` | attacker/defender/arbiter/target → 攻击方/防守方/裁决方/靶标 |

摘要前后对照（同为一条真实记录）：

| 场景 | 之前 | 现在 |
|---|---|---|
| 智能体调用 | `defender` + `agent.call.completed` | 防守方智能体调用完成：第 4 轮 · 阶段 DEFENSE · 来源 acp-rule-fallback · 耗时 2788 ms |
| 战局完成 | `battle.completed` | 系统完成战局 A-129：判定防守方胜（沦陷 0 轮 / 拦截 3 轮） |
| 样本生成 | `attack.sample.generated` | 攻击方生成攻击样本：第 2 轮 · 战术 业务字段夹带 · 强度 S3/57 |
| 载入示例 | `admin.library.seeded` | 管理员载入内置示例：新增样本 14 条、规则 5 条 |

截图：`12-audit-log.png`（默认视图，113 条，无接口流水）。

回归测试：`backend/tests/test_storage_audit.py::test_http_request_rows_are_hidden_unless_requested`、
`frontend/frontend-ui/src/AdminApp.test.tsx`（"spells out which agent call happened"）。

## 三、复现步骤

```bash
# 1) 载入/补齐内置示例（幂等）
curl -b cookie.txt -X POST https://api.yuanyiagentzhandui.cn/admin/library/seed

# 2) 库数量
curl -b cookie.txt "https://api.yuanyiagentzhandui.cn/admin/samples?limit=100"
curl -b cookie.txt "https://api.yuanyiagentzhandui.cn/admin/rules?limit=100"

# 3) 审计：默认（仅业务） 与 含接口流水
curl -b cookie.txt "https://api.yuanyiagentzhandui.cn/admin/audit-logs?limit=200"
curl -b cookie.txt "https://api.yuanyiagentzhandui.cn/admin/audit-logs?limit=200&include_http=true"
```

## 四、口径提醒

- 样本是**合成**内容，不含任何真实客户数据或真实漏洞利用代码。
- 规则库是文本规则（OWASP LLM Top 10 分类），命中只代表"文本触发"，不代表目标已被验证，
  所以每条规则结论后面都跟"真实目标未验证"，由靶标单独给结论（见 `04-mode-boundary.md`）。
