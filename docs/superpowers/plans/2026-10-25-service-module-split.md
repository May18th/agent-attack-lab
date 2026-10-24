# service.py 拆分方案（只做结构，不改行为）

- 日期：2026-10-25
- 对象：`backend/src/agent_attack_lab/service.py`
- 现状：**3955 行 / 21 path（39 endpoint）/ 87 个顶层函数 / 8 个 Pydantic 模型**
  （行数口径 = `wc -l`，基线为 `git show d2a8b11:backend/src/agent_attack_lab/service.py`；此前文中写的 3664 是估数，已按 git 实测更正）
- 目标：每个文件 ≤ 600 行，单文件单职责；接口路径、响应结构、错误码零变化

## 一、为什么要拆

| 症状 | 证据 |
|---|---|
| 单文件占后端 45% | 后端 src 共 8009 行，`service.py` 3955 行 |
| 六类职责混在一起 | 配置解析、鉴权、限流、事件构造、战局编排、报告渲染、管理端 CRUD 都在同一文件 |
| 单次改动面过大 | 一个功能改动常常同时触碰鉴权、事件、路由三段代码，review 难以聚焦 |
| 并行开发冲突 | 多个会话同时改这一文件，今晚已经出现「提交了别人正在写的快照」 |

## 二、硬约束

1. **接口契约零变化**：39 个路径、方法、查询参数、响应字段全不变。
2. **行为零变化**：鉴权语义、限流窗口、事件 payload、评分与仲裁逻辑一行不改。
3. **每步都必须是绿的**：193 passed / 5 skipped，不允许出现中间红提交（历史里已经有一个 `85a3793` 的教训）。
4. **接口不变性可机器验证**：拆分前后各导出一次 `app.openapi()`，`paths` 的键排序后必须完全一致。

## 三、目标结构

```
agent_attack_lab/
  service.py            # 186 行：app 装配、CORS、/ui 挂载、中间件、lifespan、include_router
  models.py             # 8 个 Pydantic 模型（S7 的前置：response_model 是运行时实参）
  config.py             # _env_int、路径、超时、开关常量
  state.py              # 单例：battle_store / redis_cache / 限流窗口 / 计数器 / 各类内存缓存
  security.py           # Cloudflare JWT、browser session、登录限流、鉴权依赖
  events.py             # build_event、bounded_event_data、stageId/classification、审计事件
  battle_runner.py      # 战局执行管线：run_battle_async / battle_attack / battle_defend
  scoring_glue.py       # 分数持久化、补算、battle_stats、role_scores、排行榜失效
  reports.py            # build_markdown_report（纯渲染，无 I/O）
  pages.py              # 后台页面 HTML 模板（纯字符串）
  routers/
    meta.py             # /, /dashboard, /dashboard/summary, /health, /metrics, /external-cases
    auth.py             # /login, /auth/session ×3
    admin.py            # /admin/**（样本、规则、规则候选、审计日志）
    battles.py          # /battles/**（创建/重试/取消/删除/查询/事件/回合/SSE/WS/replay/audit）
    reports.py          # /reports/{id}, /battles/{id}/report
    scores.py           # /battles/{id}/score, /internal-scores, /leaderboard
    rpc.py              # /rpc, /agent/**
```

依赖方向单向：`routers/* → battle_runner → events/security/state → config`。**任何下层模块不允许 import service**。

## 四、最大的坑：monkeypatch 目标

测试里有 **20 个 `service.*` 属性**被打桩，其中高频的：

| 属性 | 出现次数 | 拆分后应该在哪 |
|---|---|---|
| `service._battle_store` | 15 | `state.battle_store` |
| `service.app` | 12 | 仍由 `service.py` 导出（不变） |
| `service._lifespan` | 4 | `service.py`（不变） |
| `service._verify_cloudflare_access_jwt` | 3 | `security.verify_cloudflare_access_jwt` |
| `service.BattleRequest` | 3 | `models.py` |
| `service._event` | 0（实测） | `events.build_event` |
| `service._browser_client_ip` / `_rate_windows` / `_public_battle_rate_windows` | 各 1-2 | `security.*` / `state.*` |

**注意**：不能靠 `service.py` 里写 `_battle_store = state.battle_store` 这种别名兼容，因为别名是导入时静态绑定，`monkeypatch.setattr(service, "_battle_store", store)` 只改 service 模块上的名字，内部代码读 `state.battle_store` 仍拿旧值。

所以 S1 必须**一次性把测试的 patch 目标迁到新模块**（机械替换，改动可枚举），而不是靠门面兜着。

## 五、八步执行顺序

每一步单独一个 commit，提交前跑：`uv run ruff check src tests && uv run ruff format --check src tests && uv run pytest -q`。

### S0 基线（不改代码）

- 导出接口清单作为后续对比基准：
  ```bash
  uv run python -c "import json; from agent_attack_lab.service import app; print(json.dumps(sorted(app.openapi()['paths']), ensure_ascii=False, indent=0))" > /tmp/paths-before.json
  ```
- 记录：3955 行、21 path / 39 endpoint、193 passed。

### S1 抽 `state.py`（只搬单例）

- 搬：`_battle_store`、`_redis_cache`、`_rate_windows`、`_public_battle_rate_windows`、报告摘要缓存与其余内存缓存。
- 内部读写改成**函数内取值**（`state.battle_store`），不要 `from state import battle_store` 后直接用。
- 同步改测试：15 处 `service._battle_store` → `state.battle_store`；2 处 `service._redis_cache`；限流窗口各 2 处。
- 验收：193 绿 + `app.openapi()["paths"]` 与 S0 基准一致 + `state.py` 只放定义（实测 43 行）。
- 注意：这一步**不以行数为指标**。单例定义本来就只有十几行（实测迁出 14 行），真正的瘦身在 S5 与 S7；S1 的价值是把 80 余处引用改成 `state.<name>`，并在同一次提交里迁移打桩目标。

### S2 抽 `config.py`

- 搬 `_env_int` 与全部 `AGENT_*` / `CF_ACCESS_*` 常量、CORS 来源、静态资源路径、超时、开关。
- 同步改 **29 处**打桩目标（实测，不是方案最初说的"无 patch 点"）：`_api_key` 8、`_browser_password` 7、`_protect_read_routes` 4、`_cloudflare_access_configured` 2、`_browser_cookie_secure` 2、`_cloudflare_access_audience` / `_rate_limit_per_minute` / `_public_battle_limit_per_minute` / `_external_cases_database` / `_event_data_max_bytes` / `_battle_timeout_seconds` / `_cloudflare_access_team_domain` 各 1。
- 常量在 `config.py` 里去掉前导下划线（`config.api_key` 而不是 `config._api_key`），因为拆分后它是模块的公开接口。
- 验收：193 绿 + `app.openapi()["paths"]` 与 S0 基准一致 + 一次「打桩是否真的生效」的实证（改 `config.*` 后请求行为必须跟着变，否则就是 alias 造成的假绿）。
- 注意：`_aip_server_options` **不能**搬，它依赖后面才定义的 `handle_rpc_request`；`_browser_sessions` / `_browser_login_attempts` / `_cloudflare_jwk_client` 是运行时状态，留给 S3。
- 注意：删掉 `_frontend_dist` 后 `service.py` 里的 `Path` 变为未使用，`ruff --fix` 会删掉它——而 `test_service.py` 曾经用 `service.Path` 借这个副作用，需要改成测试自己 import `pathlib.Path`。

### S3 抽 `security.py`

- 搬 16 个函数：`_check_api_key`、`_verify_cloudflare_access_jwt`、`_browser_origin_allowed`、`_browser_session_digest`、`_has_browser_session`、`_issue_browser_session`、`_revoke_browser_session`、`_check_browser_session_origin`、`_check_browser_or_api_auth`、`_browser_client_ip`、`_browser_login_rate_limit`、`_api_key_dependency`、`_metrics_auth_dependency`、`_read_auth_dependency`、`_public_battle_rate_limit_dependency`、`_rate_limit_dependency`。
- **可变状态不跟着走**，按 S1 的口径归 `state.py`：`browser_sessions` + 锁、`browser_login_attempts` + 锁、`cloudflare_jwk_client` + 锁、`rate_limited_count`（后者被 `/metrics` 读）。搬走后 `verify_cloudflare_access_jwt` 与 `rate_limit_dependency` 里的两行 `global` 必须删掉——写 `state.x` 是模块属性赋值，不需要 `global`。
- 同步改测试 **14 处**：8 处打桩（`_browser_sessions` 2、`_browser_login_attempts` 4、`_cloudflare_jwk_client` 1、`_verify_cloudflare_access_jwt` 1）+ 6 处直接调用（`_verify_cloudflare_access_jwt` 3、`_browser_client_ip` 2、`_browser_origin_allowed` 1）。
- 验收：193 绿 + 契约 md5 不变 + 接线实证（清空 `state.browser_sessions` 后会话立刻失效；打桩 `security.verify_cloudflare_access_jwt` 后鉴权放行；`state.rate_limited_count` 随 429 递增）。
- 注意：本步实测迁出 265 行、`security.py` 290 行。**副作用依赖又出现一次**：`Lock` 随 `_browser_*_lock` 一起变成 service.py 里未使用的导入，被 `ruff --fix` 删掉，而 `test_service.py` 里有 `service.Lock()` —— 和 S2 的 `service.Path` 同一类，改成测试自己 `from threading import Lock`。以后每搬一块，先 grep 一遍 `service\.(被搬走的导入名)`。

### S4 抽 `events.py`

- 搬 `_event`、`_bounded_event_data`、`_event_stage_id`、`_event_classification`、`_record_audit_event`。
- 实测 **2 处** `service._event` 调用（`test_service.py` 的两个 payload 用例），另外 `test_event_contract.py` 还有 `from agent_attack_lab.service import _event` 的 import 级引用——方案最初写的「2 处」是对的；我曾因 `grep` 结果被 `head` 截断误判为 0 处，教训是**测量时不要截断输出，先看总数**。
- 唯一的耦合是 `config.event_data_max_bytes`（S2 之后已就位），所以本步在 S2 之后做最省事。
- 验收：`test_event_contract.py` 与 replay 相关用例全绿。

### S5 抽 `battle_runner.py` + `scoring_glue.py`

- `battle_runner`：`_run_battle_async`、`_run_battle_with_tracking`、`_schedule_battle_task`、`_battle_attack`、`_battle_defend`、`_tracked_agent_call`、`_mark_battle_terminal`。
- `scoring_glue`：`_persist_internal_score`、`_insufficient_internal_score`、`_backfill_missing_internal_scores`、`_run_score_backfill`、`_battle_stats`，外加 `_invalidate_leaderboard_cache`（与 `_persist_internal_score` 同属「终态副作用」，一起走）。
- 验收：战局创建/执行相关用例全绿（这是最大的一块，约占测试 60 例）。

实测修正（2026-10-25 落地时）：

1. **`create_battle` 里还有一条同步执行路径**，它也直接调用 `_tracked_agent_call` / `_battle_attack` / `_battle_defend`。方案原文只列了被搬走的 7 个函数，没提这个调用方，所以首轮替换漏了 4 处。本步只把调用点改为 `battle_runner.*`，`create_battle` 本身留到 S7 的 routers 再搬。
2. **借用式打桩共 9 处**，不是 0 处：测试用 `setattr(service, "call_attacker", ...)` / `"call_defender"` / `"score_battle"` 打桩**外部函数**，靠的是 service 的模块 globals 查找。这些函数随 `_battle_attack` / `_persist_internal_score` 一起搬走后，打桩目标必须同步迁到 `battle_runner` / `scoring_glue`，否则**测试仍会通过但打桩已成摆设**（假绿）。教训：迁移测量不能只看「service 里哪些名字被搬走」，还要扫 `setattr(service, "<外部名字>")`。
3. **两个计数器不跟着走**：`_battle_timeout_count` 被 `_run_battle_with_tracking` 写、被 `/metrics` 读；`_battle_cancel_count` 被 `cancel_battle` 写、被 `/metrics` 读。都归 `state.py`，写侧的 `global` 一并删掉。
4. **方案说的「两模块间不要互相 import」改成了单向 import**：`battle_runner → scoring_glue` 不构成环（`scoring_glue` 不回调 `battle_runner`）。若坚持传参，`_mark_battle_terminal` 得新增一个 `persist_score` 形参，签名变形会波及 `cancel_battle` 等调用方，违背「只搬结构不改接口」的约束。
5. **`configured_verify_mode` 的打桩出现分叉**：同步路径（`create_battle`，在 service）读 service 的全局名，异步路径（`run_battle_async`，在 battle_runner）读 battle_runner 的。当前两个测试都走 `POST /battles` 的同步路径，打桩 `service.configured_verify_mode` 仍然真实生效，故不动；**将来若要测异步路径的 verify mode，必须打桩 `battle_runner.configured_verify_mode`**。
6. `BattleRequest` 不必挪到 `models.py`：`service.py` 有 `from __future__ import annotations`，签名里的注解是字符串不求值，`battle_runner` 用 `TYPE_CHECKING` 导入即可，运行时鸭子类型足够。

### S6 抽 `reports.py`

- 搬 `_markdown_report`（纯渲染，入参 record/events/score/summary）。
- 验收：markdown 报告 3 个用例全绿（含今晚新增的 LLM 总结段用例）。

### S7 抽 `routers/`（实际拆成 7 个文件）

**前置 S7a：先抽 `models.py`。** 路由函数用 `BattleRecord` / `BattleRequest` 等模型做 `response_model=` 和参数注解；`response_model=` 是**运行时实参，必须真求值**，`from __future__ import annotations` 只让注解变成字符串，救不了它。若 router 直接 `from service import BattleRecord`，而 service 又要 import routers 做 `include_router`，就成环了。所以 `models.py` 必须先存在（S7a 已落地：8 个模型 / 89 行，`service.py` 减 68 行，3 处测试打桩迁移）。

**S7-0（前置，方案原文漏了）：把路由要读的名字下沉。**

路由处理器依赖几个还留在 service 的模块级变量，不先搬走，router 就得 import service。实测要下沉的是：

- `state.started_at` + 4 个请求计数器（中间件写、`/health` 与 `/metrics` 读）
- `scoring_glue.role_scores`（原 `service._scores`，报表与排行榜共用）
- `_admin_write_audit` 不单独下沉，直接随 admin 路由搬进 `routers/admin.py`（它是那批接口的审计前置，不是通用工具）

**S7-1…S7-7：一次一个 router，每次搬完跑全量。**

顺序与实测行数：

| 步骤 | 模块 | 行数 | 端点 |
|---|---|---|---|
| S7-1 | `pages.py` + `routers/meta.py` | 1075 + 197 | 6 |
| S7-2 | `routers/auth.py` | 194 | 4 |
| S7-3 | `routers/admin.py` | 191 | 10 |
| S7-4 | `routers/reports.py` | 109 | 2 |
| S7-5 | `routers/scores.py` | 124 | 3 |
| S7-6 | `routers/battles.py` | 795 | 12 |
| S7-7 | `routers/rpc.py` | 153 | 3 |

与方案原文的差异，都是实测后改的：

1. **多了 `pages.py`。** `/dashboard` 是一个 1065 行的 HTML 模板，塞进 `meta.py` 会让那个文件同样不可读。模板单独成模块，路由只保留鉴权与 303 跳转。
2. **多了 `routers/scores.py`。** `/internal-scores` 与 `/leaderboard` 既不属于战局也不属于报表，硬塞会让文件名不副实。
3. **`config.service_version`。** `/health` 原来读 `app.version`，而 app 只在 `service.py` 里；router 去 import 会成环。

已知需要迁移的打桩，全部已迁并断言新位置生效：

- `service.summarize_report`（3 处）→ `routers.reports`
- `service.suggest_rule_candidate`（1 处）→ `routers.admin`
- `service.configured_verify_mode`（2 处）→ `routers.battles`（S5 记下的「同步路径读 service 全局名」分叉在这里引爆）

搬走后 service 不再导入这些名字，测试里另外两处**借 service 命名空间**的写法也一并修掉：`service.ACPAgentError` → 直接 import `acp_agents`，`service.asyncio` → 测试自己 import。

### S8 对比与收尾

不能只看 `openapi()`：**39 个端点里有 10 个是 `include_in_schema=False`**（`/`、`/dashboard`、`/login`、`/metrics`、`/rpc`、`/agent/attack`、`/agent/defend`、`/battles/{id}/events/stream`、`/battles/{id}/replay`、`/battles/{id}/report`），剩下 29 个才进 schema，契约快照根本看不到那 10 个。

三层验证：

1. **契约**：拆分前后各导出 `app.openapi()["paths"]`，md5 必须相同（本次全程 `12465f27…`，21 path / 29 个入 schema 的 endpoint；全部 39 个 endpoint 里有 10 个不入 schema，见上）。
2. **路由表**：展开 `app.routes`（这版 Starlette 把 `include_router` 存成 `_IncludedRouter`，要走 `original_router.routes` 递归），逐项比对 path / methods / 函数名 / tags / summary / response_model / 依赖数。拆分前后都是 **39 APIRoute + 1 WebSocket + 4 内建 Route**，其中 29 个进 schema、19 个带鉴权依赖。
3. **运行时等价**：把基线版本的 `service.py` 单独加载成 `old_service` 模块，两套 app 并行驱动，逐字节比对响应。每个 router 的用例数：meta 7、auth 13、admin 20、reports 7、scores 7、battles 25 + WebSocket 14 帧、rpc 11。

对拍脚本必须处理**两套 app 共享同一份 `state`** 这件事，否则会把共用状态的副作用误判成回归（已踩三次）：

- `state.browser_login_attempts` 被第一轮填满 → 第二轮登录 429
- `state.public_battle_rate_windows` 同上
- `state.report_summary_cache` / `leaderboard_cache` / `battle_store` 必须每轮重建，否则第二次不调摘要函数
- 耗时类字段（`durationMs`）与随机 id 要归一化；注意 SSE 里是带空格的 `": "`，紧格式正则匹配不到

- 检查每个文件行数（结果见下）。
- `backend/README.md` 增加「代码结构」一节。

## 九、S8 验收结果

| 文件 | 行数 |
|---|---|
| `service.py` | **186**（原 3955，−95%） |
| `pages.py` | 1075（HTML 模板） |
| `routers/battles.py` | 795 |
| `routers/meta.py` | 197 |
| `routers/auth.py` | 194 |
| `routers/admin.py` | 191 |
| `routers/rpc.py` | 153 |
| `routers/scores.py` | 124 |
| `routers/reports.py` | 109 |
| `config.py` / `security.py` / `events.py` / `battle_runner.py` / `scoring_glue.py` / `models.py` / `state.py` | 155 / 290 / 139 / 394 / 140 / 89 / 65 |

`service.py` 现在只剩：`app = FastAPI(...)`、CORS、`/ui` 静态挂载、`_request_id`、请求指标中间件、`_lifespan`、7 个 `include_router`。

唯一超过 600 行的业务文件是 `routers/battles.py`（795）：里面是 12 个端点，其中 `create_battle` 一个函数就含同步与异步两条执行路径。再拆会让「创建战局」这条主线跨文件，收益不抵成本，本次不动。

依赖方向已实证：`routers/*` 七个模块逐个独立 import，`agent_attack_lab.service` 都不在 `sys.modules` 里。

### 合并后的终验（对「重构前的基线」而非对「上一版」）

不再依赖任何临时快照文件：用 `git show d2a8b11:backend/src/agent_attack_lab/service.py` 取出**重构前的原始 3955 行文件**，按真实深度落到 `backend/src/agent_attack_lab/` 下（基线里 `Path(__file__).parents[3]` 要推 `frontend/frontend-ui/dist`，放浅了会 `IndexError`），`importlib` 以 `old_service` 载入，与主干同进程对比：

| 项 | 基线 d2a8b11 | 主干 ff29a02 | 结果 |
|---|---|---|---|
| `openapi()["paths"]` md5 | `205720905bff8a2de3d92df4323aa4c0` | 同 | 一致（21 path） |
| 路由表（path, methods, 依赖数, 是否入 schema） | 40 条 | 40 条 | 逐条一致（39 APIRoute + 1 WS） |
| `GET /dashboard` 响应体 | 76607 B | 76607 B | 字节一致 |
| `pytest -q` | — | 193 passed / 5 skipped，**exit=0** | 绿 |
| `ruff check` + `format --check` | — | 全绿（72 files formatted） | 绿 |

两个必须记住的坑：

1. **契约 md5 有两套口径**：`print(json.dumps(...))` 写文件会多一个换行，得 `12465f27…`；直接 `md5(json.dumps(...).encode())` 得 `20572090…`。内容完全相同，**比对时必须两侧同口径**，否则会误判成「契约变了」。
2. **`pytest` 可能「全过却 exit=1」**：本机沙箱的批量删除保护会在 session 收尾清理 `Temp/pytest-of-*/garbage-*`（88 个文件 > 阈值 50）时打断进程，**汇总行被吞掉且退出码为 1**，看起来像红灯。用 `--basetemp=<固定目录>` 绕开垃圾回收即得 `exit=0`；`--junitxml` 里的 `tests/failures/errors` 也可用来交叉验证。

## 六、风险与应对

| 风险 | 应对 |
|---|---|
| 循环导入 | S1 起就坚持单向依赖；发现需要反向引用时，改成把依赖作为参数传入 |
| monkeypatch 失效导致测试假绿 | 每步跑「全量」而不是只跑相关文件；S1 的 patch 目标迁移单独验证一次（故意 patch 后断言生效） |
| 与并行会话冲突 | 在独立 `git worktree` 里做，全部完成后一次性合入；不要和别的任务共用工作区 |
| 中间步骤 red | 每步提交前必须本地绿；CI 已在所有分支运行，push 即验证 |
| 拆分期间 main 有新提交 | 每步开始前 `git rebase origin/main`，小步快跑，避免长分支 |

## 七、明确不做

- 不改任何接口路径、状态码、响应字段
- 不换框架、不引入依赖注入容器、不加新依赖
- 不趁机重写鉴权或限流逻辑（那是行为变更，需要单独评审）
- 不合并/删除测试用例

## 八、工作量

8 个 commit，预计 4-6 小时；S1 和 S5 占一半时间。若中途时间不足，停在任意一个已绿的步骤都是可交付状态（不是半成品）。
