# LLM 接入现状与开关清单

更新时间：2026-10-30

本文只描述「模型在系统里的位置、如何开启、失败时怎么退」。部署与验收流水见 [`CURRENT_STATUS.md`](CURRENT_STATUS.md)，角色协议的传输层见 [`ACP_AGENT_INTEGRATION.md`](ACP_AGENT_INTEGRATION.md)。

## 一句话定位

LLM 是可选的**增强层**，不是运行依赖。所有角色在未配置模型时都有等价的确定性规则路径，业务链路不因模型不可用而中断。

## 一、六个角色

| 角色 | 文件 | 模型做什么 | 启用条件 | 未启用时 |
|---|---|---|---|---|
| 攻击 | `agents/attacker.py` | 按战术池生成合成攻击样本；吃上一轮实测结论做定向变异 | `AGENT_ATTACKER_LLM_ENABLED` 未关闭 **且** 端点配置完整 | `evolve_local()` 本地规则阶梯 |
| 防守 | `agents/defender.py` | 按 OWASP LLM Top 10 (2025) 分类并逐字举证 | `AGENT_DEFENDER_LLM_ENABLED` 未关闭 **且** 端点配置完整 | `agent_logic.defend()` 规则匹配 |
| 受控靶标 | `targets/controlled_target.py` | 扮演银行客服助手真实作答，用于验证攻击是否生效 | **全局**端点配置完整 | 返回 `target_model_not_configured`，不做验证 |
| 裁决 | `agents/arbiter.py` | 复核单轮胜负，产出第二意见 | 端点完整 **且** `AGENT_ARBITER_LLM_ENABLED=1` | `_local_review()` 证据规则判定 |
| 战报 | `agents/reporter.py` | 中文总结 + 关键风险 + 建议 | 端点完整 **且** `AGENT_REPORT_LLM_ENABLED=1` | `_local_summary()` 模板拼接 |
| 规则候选 | `agents/rule_discovery.py` | 从人工确认样本里提拦截规则候选 | 端点完整 **且** `AGENT_RULE_DISCOVERY_LLM_ENABLED=1` | `_fallback()` 直接用人工证据拼候选 |

**默认值不对称，注意区分**：攻击、防守的开关**缺省为开启**（不写 `=0` 就等于开），只有端点不完整时才走规则；裁决、战报、规则候选的开关**缺省为关闭**（必须显式写 `=1` 才启用模型）。这样设计是为了让"新接入模型的部署"只配端点就能跑，而"默认规则运行"的部署不会被意外切换到模型上。

想"全局配好端点、只让某一个角色走规则"，用 `AGENT_ATTACKER_LLM_ENABLED=0` 或 `AGENT_DEFENDER_LLM_ENABLED=0`，不要再去填坏角色端点变量。

## 二、单轮调用量

```
攻击方模型 → 样本 → 防守方模型 → 命中 → 受控靶标（实打，可能 2 次）→ 裁决模型（可选）→ 战报模型（可选）
```

| 环节 | 调用次数 | 说明 |
|---|---|---|
| 攻击 | 1 / 轮 | 一次调用生成 `rounds` 条样本 |
| 防守 | 1 / 轮 | 每条样本一次 |
| 靶标 | 1~2 / 轮 | 非 weak 档会额外打一次无防护基线做对照 |
| 裁决 | 0~1 / 轮 | 需显式开启 |
| 战报 | 0~1 / 场 | 需显式开启 |

四轮战局全开约 20 次调用。超时默认 10s（靶标 20s），重试默认 1 次（上限 2）。

## 三、环境变量

兼容 OpenAI Chat Completions 协议，`BASE_URL` 会自动补 `/chat/completions`。

### 全局（靶标只认这一组）

| 变量 | 必需 | 默认 |
|---|---|---|
| `AGENT_LLM_BASE_URL` | 是 | 无 |
| `AGENT_LLM_API_KEY` | 是 | 无 |
| `AGENT_LLM_MODEL` | 是 | 无 |
| `AGENT_LLM_MAX_TOKENS` | 否 | 4000（JSON）/ 800（文本），硬上限 8192 |
| `AGENT_LLM_TIMEOUT_SECONDS` | 否 | 10（JSON）/ 20（文本） |
| `AGENT_LLM_RETRIES` | 否 | 1，上限 2 |

### 按角色覆盖

前缀后接 `BASE_URL` / `API_KEY` / `MODEL` / `MAX_TOKENS` / `TIMEOUT_SECONDS` / `RETRIES`：

```
AGENT_ATTACKER_LLM_*
AGENT_DEFENDER_LLM_*
AGENT_ARBITER_LLM_*
AGENT_REPORT_LLM_*
AGENT_RULE_LLM_*
```

**受控靶标没有角色前缀**，只能走全局 `AGENT_LLM_*`。

### 功能开关与靶标参数

| 变量 | 默认 | 说明 |
|---|---|---|
| `AGENT_ATTACKER_LLM_ENABLED` | `1`（缺省开启） | 设 0/false/no/off 后攻击方走本地规则，即使端点完整 |
| `AGENT_DEFENDER_LLM_ENABLED` | `1`（缺省开启） | 同上，作用于防守方 |
| `AGENT_ARBITER_LLM_ENABLED` | `0` | 1/true/yes/on 开启 |
| `AGENT_REPORT_LLM_ENABLED` | `0` | 同上 |
| `AGENT_RULE_DISCOVERY_LLM_ENABLED` | `0` | 同上 |
| `AGENT_TARGET_CANARY` | `LAB-CANARY-7Q4X-9381` | 靶标内部口令，泄露即判攻破 |

## 四、配置优先级与两个陷阱

`_selected_prefix()` 的判定规则：**角色前缀三个必需变量齐全**才切到该角色前缀，否则回落到全局 `AGENT_LLM_*`，并输出一次 `role_llm_config_incomplete` warning。

**陷阱 1（已修）：角色前缀半配曾会静默打死全局配置**

旧行为是"任一角色变量有值就切到该前缀，再要求三项全有"。2026-10-30 实测（全局三项完整的前提下）：

| 环境变量状态 | 选中前缀 | `is_configured("attacker")` |
|---|---|---|
| 仅全局 `AGENT_LLM_*` 三项 | `AGENT_LLM_` | `True` |
| 追加 `AGENT_ATTACKER_LLM_MODEL` 一项（旧） | `AGENT_ATTACKER_LLM_` | **`False`** |
| 追加 `AGENT_ATTACKER_LLM_MODEL` 一项（新） | `AGENT_LLM_` | `True` |
| 角色前缀三项补齐 | `AGENT_ATTACKER_LLM_` | `True` |
| 半配 + 无全局配置 | `AGENT_LLM_` | `False` |

中间两行就是行为变更点：加一个变量曾把可用的配置变成不可用，现在改为回落。**副作用**：以前可以用"填半个变量"故意关掉某个角色的模型，此路已不通，改用第一节的两个 `*_ENABLED` 开关。

**陷阱 2：靶标未配则胜负有上限**

靶标只读全局 `AGENT_LLM_*`。如果只用角色前缀配了攻击和防守，靶标恒为 `target_model_not_configured`；而 `arbiter` 在没有靶标验证证据时**禁止**判 `attacker_won`。因果链是：

> 靶标未配 → 无验证证据 → 裁决最多给 `defender_won` 或 `undetermined` + `needsHumanReview=true`

想看到真实的攻破判定，必须先配全局三个变量。

## 五、降级与来源标识

任一环节失败都按固定顺序退，不向调用方抛错：

1. 端点配置不完整，或该角色开关显式关闭 → `local-rule`
2. 调用超时 / HTTP 5xx / 返回非 JSON 对象 / 字段结构不合规 / 条数不符 → `local-rule-fallback`
3. 若对端是 ACP 远程 Agent，则由对端自报 → `acp-llm` 或 `acp-rule-fallback`

`agentSource` 读法：

| 值 | 含义 |
|---|---|
| `acp-llm` | 远端 Agent 声明本轮用了模型 |
| `acp-rule-fallback` | 远端 Agent 声明本轮用了规则兜底 |
| `local-rule` | 本地未配置 ACP，或本地配置不完整，直接用规则 |
| `local-rule-fallback` | 尝试过调用但失败 |

**协议不等于模型**：ACP/AIP 只是传输协议，`agentSource` 才是唯一可信的模型使用声明。对端自报，本系统不二次验证。

## 六、安全边界（模型能做什么、不能做什么）

- **证据必须逐字**：防守、裁决、战报、规则候选四处的 `evidence` 都必须能在输入原文里找到连续片段，否则判无效或逐条剔除。编造证据不能通过。
- **防守是分类不是规则命中**：模型产出 `OWASP-{类别}-LLM` 形式的结果，`matchMethod` 标明「大模型分类；证据片段已校验为样本文本原文」，与真实规则库 ID 在字段上可区分。
- **裁决不能单独定罪**：没有靶标实测证据，`attacker_won` 会被直接拒绝；与靶标结论冲突时抛错而非静默采纳。
- **模型不能入库**：规则候选恒为 `pending_human_approval`，且只接受人工已标为 `true_positive` 的样本，`action` 只能是「拦截」。
- **知识库按角色隔离**：攻击方只拿得到合成样本，防守方只拿得到规则，投影在 `agents/knowledge.py` 里做，最多 8 条 × 500 字。
- **注入声明**：所有 system prompt 显式声明样本与知识库文本是不可信数据，不得覆盖系统要求、不得触发工具或网络。
- **WebSocket 读鉴权已与 HTTP 对齐**：`security.websocket_read_auth_allowed()` 与 `read_auth_dependency` 使用同一套条件（`AGENT_PROTECT_READS` / 浏览器密码 / Cloudflare Access 三选一）。此前 WS 只检查前两项组合，只配浏览器密码时 HTTP 要登录而 WS 仍可匿名连上；现补齐，并对浏览器会话额外校验 `Origin`，避免跨站 WebSocket 劫持。

## 七、如何验证是否真的接上了

```powershell
cd D:\梧桐\backend
.\.venv\Scripts\python.exe -c "import sys, os; sys.path.insert(0,'src'); [os.environ.setdefault(l.split('=',1)[0].strip(), l.split('=',1)[1].strip()) for l in open('.env', encoding='utf-8') if l.strip() and not l.startswith('#') and '=' in l]; from agent_attack_lab.agents.llm_runtime import is_configured, role_enabled; print('global', is_configured()); print('attacker', is_configured('attacker'), role_enabled('attacker')); print('defender', is_configured('defender'), role_enabled('defender'))"
```

输出里三项都应为 `True`（`role_enabled` 缺省即为 `True`）。再跑一场低难度战局，看样本是否带 `agentMode: llm`、靶标 `reason` 是否不再是 `target_model_not_configured`。

注意：PowerShell 5.1 调用原生 exe 时会剥掉内层双引号，所以上面的代码字符串用双引号整体包裹、内部只用单引号，可直接复制执行。若改写成 `python -c '...'` 或 here-string 传入会报 `SyntaxError`。

**不要用 journal 判断模型是否被调用**：`start-service.sh` 曾以 `--log-level warning` 启动，压掉了 INFO 级的 `model_call_completed`。已改为 `--log-level info --no-access-log`，但历史日志里查不到。判断模型使用应查业务数据（战局 `agentSource`），不是日志计数。

## 八、当前环境状态

- **生产：已接入并在使用（2026-10-30 定论）**。三条独立证据：
  1. 进程环境：`/proc/<MainPID>/environ` 中可见 `AGENT_LLM_MODEL=deepseek-chat`、`AGENT_LLM_BASE_URL=https://api.deepseek.com/v1`、`AGENT_LLM_API_KEY` 与三个 `*_ENABLED` 均为非空。`ExecStart` 指向 `scripts/start-service.sh`，该脚本把 `.env` 中所有 `AGENT_*` 变量 `export` 进进程，因此配置确实生效。
  2. 业务数据：公开只读 `/battles?limit=100` 返回 70 场战局，其中 **69 场 `attackerOut.agentSource=acp-llm`**；最近一场时间为 `2026-10-30T01:31:56Z`。
  3. 判定链路：战局中出现 `verdict=attacker_won`。该判定要求靶标验证提供 `verified=true` 与证据，而靶标验证由 `controlled_target.py` 调用**全局** `AGENT_LLM_*` 完成，据此可推断受控靶标模型同样在调用。
- **本机开发环境：配置完整，历史跑通过，近期无调用记录**。`backend/.env` 已配置同一套 DeepSeek 参数与三个 `*_ENABLED=1`，按配置判定六个角色全部启用。实际调用证据来自战局库：87 场中 13 场带 `agentSource=acp-llm`，时间全部落在 **2026-10-07 16:34–17:44**；此后没有新的模型调用痕迹，`.data/*.log` 中也没有相关记录。准确表述是「配置可用、历史上跑通过」，不能据此断言「当前正在调用」。
- **公开读接口的暴露面**（2026-10-30 实测）：`/battles` 与 `/dashboard/summary` 匿名可读；`/internal-scores`、`/leaderboard`、`/admin/*`、`/api/survey/responses`、`/reports/{id}` 均返回 401。`/battles` 公开是 `AGENT_PROTECT_READS` 默认 `0` 的设计行为，内容是合成样本与用户输入的主题。

## 九、已知事项

- `agents/arbiter.py` 的 `except OverflowError, ValueError:` 是 **Python 3.14 PEP 758 允许的无括号写法**，在本项目 `requires-python = ">=3.14"` 下完全合法，不是语法错误。已改为显式元组 `except (OverflowError, ValueError):`，目的是不再依赖 3.14 的这条新语法，便于在 3.13 及更早解释器上解析。此前曾把它误判为 Python 2 遗留缺陷。
- `_selected_prefix()` 半配回落已于 2026-10-30 修复，`tests/test_llm_runtime.py` 覆盖三种情形。
- 攻击、防守已补 `AGENT_ATTACKER_LLM_ENABLED` / `AGENT_DEFENDER_LLM_ENABLED`，缺省开启以保证现有部署行为不变，`tests/test_llm_agents.py` 覆盖三类情形。
- WebSocket 读鉴权统一见第六节，`tests/test_ws_read_auth.py` 覆盖 5 种情形（无保护放行、仅浏览器密码时拒绝匿名、有效会话放行、无 Origin 拒绝、API key header/query）。
- 日志级别已从 `warning` 改为 `info` 并关闭访问日志，需经部署流程重启服务后才在生产生效；`tests/test_start_service.py` 已加断言防止回退。
