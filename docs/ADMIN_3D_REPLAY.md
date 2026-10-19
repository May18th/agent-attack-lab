# 管理后台攻防事件 3D 回放

## 当前实现范围

本项目现有技术栈为 FastAPI + React/TypeScript + Three.js；此模块沿用现有项目，不将整站迁移到 Django/Vue。回放读取已持久化的 `battle_events`，以事件序号、记录的 Agent 角色、round、correlationId 和显式前置事件引用构建攻防交互路径。

这是一种基于战局事件的逻辑回放，不是网络流量取证回放。当前数据库没有设备清单、设备坐标、物理链路、源/目的 IP、流量字节数或抓包记录，因此界面不会虚构这些字段或把回放动画宣称为真实网络数据包。3D 画布使用抽象几何节点、事件关联光纤和播放能量包表达审计事件关系，不代表真实资产盘点、物理网络布线或采集到的网络流量。

## API

### 战局列表

`GET /battles?limit=50&offset=0&difficulty=high&q=关键词`

返回当前存储的战局记录数组，`X-Total-Count` 为筛选后的总数。记录包含 `id`、`topic`、`difficulty`、`status`、`createdAt`、`attackerOut`、`defenderOut`。当前没有单独的回放记录表或参与物理设备清单。

### 事件序列

`GET /battles/{battle_id}/events`

查询参数：

| 参数 | 默认/限制 | 含义 |
| --- | --- | --- |
| `limit` | 默认 200，1–1000 | 当前页上限 |
| `after_sequence` | 默认 0，最小 0 | 只返回序号大于游标的记录 |
| `event_type` | 最长 64 字符 | 精确匹配事件类型 |
| `from_time` | ISO 8601 | 起始时间，包含边界 |
| `to_time` | ISO 8601 | 结束时间，包含边界 |
| `q` | 最长 200 字符 | 搜索事件类型和原始 `data` |

响应体保持兼容的事件数组结构，按 `sequence` 升序：

```json
[
  {
    "id": "event-id",
    "battleId": "battle-id",
    "sequence": 12,
    "type": "round.completed",
    "status": "completed",
    "createdAt": "2026-10-19T00:00:00+00:00",
    "data": {"agentRole": "defender", "round": 2}
  }
]
```

分页响应头：`X-Total-Count` 为筛选后的总匹配数，`X-Has-More` 指示是否有下一页，非空页的 `X-Next-Sequence` 为下一次请求使用的游标。下一页必须重复相同筛选参数，只更新 `after_sequence`。这三个响应头已加入 CORS expose headers。

常见状态码：`200` 成功、`401/403` 凭证或访问策略拒绝、`404` 战局不存在、`422` 查询参数无效。

回放事件当前只提供审计事件自身的 `id/battleId/sequence/type/status/createdAt/data`。`data` 中出现的角色、轮次或关联标识只按原始记录展示；源/目标设备、IP、流量大小、执行命令等字段仅在未来采集端实际写入后才可作为事实显示。

## 鉴权边界

事件路由使用现有 `_read_auth_dependency`：启用 `AGENT_PROTECT_READS`、浏览器密码会话或 Cloudflare Access 时执行对应读接口认证。项目尚无管理员/讲师/学员角色表和 RBAC 授权，因此目前不能提供“仅管理员”角色级校验。生产环境必须确保管理端点前置 Cloudflare Access 或启用后端读鉴权；不能把条件关闭的内部读接口暴露到公网。

## 前端行为

- 后台按 200 条读取事件，点击“加载更多事件”使用序号游标继续拉取。
- 播放、暂停、0.25×–4× 倍速、进度跳转和点击事件定位均由已读取事件驱动。
- 攻守角色只从事件角色/类型推断；未知来源保持“未记录”，不强行归类。
- 交互边使用明确的 `round`、`correlationId`、前置事件引用，或记录序列中明确相邻的攻守角色切换；这些边代表审计事件关联，不等同真实网络连接。
- 搜索范围为当前已加载页面集合。部分事件导出会标记 `complete: false`，加载完毕后导出完整已读取的事件。

## 3D 渲染

- 回放画布保留原布局、播放控件、事件顺序、详情面板和 API 契约；当前改造限于 Three.js 渲染层及其资源。
- 攻击方、防守方和调度中心使用同一几何载体设计体系，以外壳轮廓、金属边线和半透明能量核心区分角色；事件和普通关联节点使用同体系的精简载体。
- 网络关系以低透明度管状光纤呈现；回放能量包为六边形晶片、中心核心与多段拖尾组成。它表示当前审计事件的逻辑移动，不代表抓包记录或真实数据包。
- 场景采用深色网格、轻雾与低密度星点；扫描、攻击、攻陷和选中状态分别使用青色扫描波、橙色链路增强、明确攻陷事件的红色脉冲和蓝色聚焦环。
- 节点超过 24 个或处于远景时隐藏电路线纹并降低光晕强度；场景不启用实时阴影。事件角色只按原审计记录判断；攻陷仅在事件明确描述攻陷/入侵成功时标记，不从战局失败状态推断。
- 设备 IP 未记录时明确显示“未记录”；不会从型号或演示数据构造设备 IP、物理位置或真实网络流量。

## 本地启动与校验

后端（Windows PowerShell）：

```powershell
cd D:\梧桐\backend
uv sync
.\start.ps1
```

前端（新终端）：

```powershell
cd D:\梧桐\frontend\frontend-ui
npm ci
$env:VITE_AGENT_API = "http://127.0.0.1:8787"
npm run dev
```

验证：

```powershell
npm test
npm run lint
npm run build
cd D:\梧桐\backend
uv run pytest -q
```

前端依赖沿用仓库锁定版本：React 19、Three.js 0.186（包含 GLTFLoader）、TypeScript 6、Vite 8、Vitest 5。后端沿用 `backend/pyproject.toml` 的 FastAPI 与当前数据库抽象；接口结构不变，也没有新增表或迁移。Django 6、Vue 3、Element Plus 和 ECharts 未加入项目，因为本次约束要求复用现有页面与 API。

## 后续接入真实硬件回放所需数据

需要审计/采集端提供稳定的设备 ID、设备类型、每场战局拓扑快照及节点坐标、源/目标设备 ID、源/目的 IP、流量大小、协议/方向和统一时间戳；同时需提供具备许可的 GLB/GLTF 模型及映射配置。管理员角色校验还需先建立可验证的身份与角色授权来源。缺少这些上游数据前，3D 展示只能准确反映 Agent 事件关系。
