# 项目协作规则

## 项目边界

- 项目名称：智能体攻防实验室。
- 本项目与之前的科创项目完全独立。
- 当前项目目录：`D:\梧桐`。
- 后端目录：`D:\梧桐\backend`。
- 前端目录：`D:\梧桐\frontend`。
- 协作文档目录：`D:\梧桐\docs`。

## 文档和接口约定

- 前后端接口以 `TEAM_HANDOFF.md` 和 FastAPI `/docs` 为准。
- 给前端队友的通知和交接材料优先使用 Markdown 文件。
- 当前主流程使用 `POST /battles`，返回攻击结果和防守结果。
- 当前暂不把 WebSocket、arbiter 独立 Agent、score、round、correlationId 和实时事件作为第一版验收项。

## 前后端分工

- 前端负责页面、交互、加载状态、错误提示和结果展示。
- 后端负责 Agent 逻辑、接口、JSON-RPC/AIP、数据存储和公网服务。
- 前端不修改 AIC、ACS、CAI、mTLS 证书、`.venv` 或 `.data`。

## 回复偏好

- 涉及配置、代码或交接材料时，默认提供完整内容，不只提供片段。
- 说明操作步骤时使用中文和 PowerShell 命令。
- 不编造 AIC、CAI、证书或平台审核结果。

## 当前交接文件

- `TEAM_HANDOFF.md`：完整前后端接口交接。
- `FRONTEND_TEAM_MESSAGE.md`：可直接转发给前端队友的通知和回执模板。
