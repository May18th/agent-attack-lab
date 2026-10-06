# 智能体攻防实验室前端联调通知

已收到你导出的《智能体攻防实验室对抗互联零基础开发应用教程》，内容整体方向正确，可以作为零基础学习和开发参考。

当前联调请以 `TEAM_HANDOFF.md` 和后端 `/docs` 接口文档为准，不要完全照教程中的规划功能实现。

## 当前后端地址

本地地址：

```text
http://127.0.0.1:8787
```

稳定公网地址（当前可用）：

```text
https://api.kcwx.online
```

## 当前可用接口

```text
POST /battles
GET  /battles
GET  /battles/{battle_id}
GET  /health
POST /agent/attack
POST /agent/defend
POST /rpc
```

## 第一版前端主流程

1. 选择主题和难度。
2. 调用 `POST /battles`。
3. 展示 `attackerOut.samples`。
4. 展示 `defenderOut` 中的 `caught`、`risks`、`fixed`。
5. 展示 `status`、战局 ID 和创建时间。
6. 处理加载中、成功、空结果、404、422、5xx 状态。

## 前端环境变量

在前端项目的 `.env.local` 中配置：

```env
VITE_AGENT_API=http://127.0.0.1:8787
```

远程联调时使用：

```env
VITE_AGENT_API=https://api.kcwx.online
```

当前前端公网页面由队友 Quick Tunnel 的终端输出决定，地址会随重启变化。

## 当前暂不作为验收项的功能

以下功能属于后续扩展，第一版不要因为它们阻塞页面开发：

- WebSocket `/ws/battles/{battleId}`
- arbiter 独立 Agent
- `score` 和 `round`
- `correlationId` 日志
- `connected` 事件
- 实时事件时间线

## 当前实际行为

```text
low  -> defect
mid  -> defect + violation
high -> defect + violation + vuln
```

`topic` 当前最大长度为 200。前端不要自行修改接口字段名，字段需要变更时先同步后端。

## 前端完成后的回执格式

请完成联调后按下面格式回复：

```text
前端联调回执：

1. 前端项目路径：
2. 启动命令：
3. VITE_AGENT_API 配置：
4. 是否成功调用 POST /battles：
5. 是否展示 attackerOut：
6. 是否展示 defenderOut：
7. 是否处理加载状态：
8. 是否处理 404、422、5xx：
9. 当前已知问题：
10. 下一步需要后端配合的内容：
```

## 协作边界

前端不需要修改或运行 AIC、ACS、CAI、mTLS 证书和后端数据库文件。后端字段变更前先同步，提交代码时不要包含 `.venv` 和 `.data`。
