# service.py 拆分方案（只做结构，不改行为）

- 日期：2026-10-25
- 对象：`backend/src/agent_attack_lab/service.py`
- 现状：**3664 行 / 39 个 HTTP 接口 / 87 个顶层函数 / 8 个 Pydantic 模型**
- 目标：每个文件 ≤ 600 行，单文件单职责；接口路径、响应结构、错误码零变化

## 一、为什么要拆

| 症状 | 证据 |
|---|---|
| 单文件占后端 45% | 后端 src 共 8009 行，`service.py` 3664 行 |
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
  service.py            # ~250 行：app 装配、lifespan、中间件、include_router
  config.py             # _env_int、路径、超时、开关常量
  state.py              # 单例：battle_store / redis_cache / 限流窗口 / 各类内存缓存
  security.py           # Cloudflare JWT、browser session、登录限流、鉴权依赖
  events.py             # _event、_bounded_event_data、stageId/classification、审计事件
  battle_runner.py      # 战局执行管线：_run_battle_async / _battle_attack / _battle_defend
  scoring_glue.py       # 分数持久化、补算、_battle_stats
  reports.py            # _markdown_report（纯渲染，无 I/O）
  routers/
    meta.py             # /, /dashboard, /metrics, /health
    auth.py             # /login, /auth/session
    battles.py          # /battles/**（创建/查询/事件/回合/评分/重试/取消/删除/SSE）
    reports.py          # /reports/{id}, /battles/{id}/report
    admin.py            # /admin/**（样本、规则、审计日志、规则候选）
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
- 记录：3664 行、39 接口、193 passed。

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
- 实测 **0 处** `service._event` 打桩（方案最初写的 2 处在当前代码里已不存在；`test_battle_audit.py` 里的 `_event` 是该文件自己的本地 helper，首参是 sequence，与 service 无关）。
- 唯一的耦合是 `_event_data_max_bytes`，它在 S2 之后已经变成 `config.event_data_max_bytes`，所以本步必须在 S2 之后做，否则该常量会被切碎成两处配置。
- 验收：`test_event_contract.py` 与 replay 相关用例全绿。

### S5 抽 `battle_runner.py` + `scoring_glue.py`

- `battle_runner`：`_run_battle_async`、`_run_battle_with_tracking`、`_schedule_battle_task`、`_battle_attack`、`_battle_defend`、`_tracked_agent_call`、`_mark_battle_terminal`。
- `scoring_glue`：`_persist_internal_score`、`_insufficient_internal_score`、`_backfill_missing_internal_scores`、`_run_score_backfill`、`_battle_stats`。
- 这两个模块间的引用必须显式传参，不要互相 import。
- 验收：战局创建/执行相关用例全绿（这是最大的一块，约占测试 60 例）。

### S6 抽 `reports.py`

- 搬 `_markdown_report`（纯渲染，入参 record/events/score/summary）。
- 验收：markdown 报告 3 个用例全绿（含今晚新增的 LLM 总结段用例）。

### S7 抽 `routers/`（按域拆 6 个文件）

- 每次只搬一个 router，搬完立刻跑全量：`meta → auth → admin → reports → battles → rpc`。
- 顺序按依赖从少到多，`battles.py` 最大放最后。
- `service.py` 只留：`app = FastAPI(...)`、`_lifespan`、中间件、`include_router`。
- 验收：每搬一个 router，`openapi()` 的 paths 必须仍等于基准。

### S8 对比与收尾

```bash
uv run python -c "import json; from agent_attack_lab.service import app; print(json.dumps(sorted(app.openapi()['paths']), ensure_ascii=False, indent=0))" > /tmp/paths-after.json
diff /tmp/paths-before.json /tmp/paths-after.json   # 必须为空
```

- 检查每个文件行数 ≤ 600。
- 更新 `backend/README.md` 的目录结构说明。

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
