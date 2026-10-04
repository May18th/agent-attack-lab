# 智能体攻防实验室

这是独立的智能体攻防实验室项目。

## 目录

- `backend/`：FastAPI 后端、Agent 逻辑和测试
- `frontend/`：前端联调材料和队友文件
- `docs/`：接口契约与协作规则

协作边界详见 `docs/COLLABORATION_BOUNDARIES.md`。

## 后端启动

```powershell
cd "D:\梧桐\backend"
uv sync
.\restart.ps1
```

验证测试和服务：

```powershell
.\verify.ps1
```

中文后台页面：`http://127.0.0.1:8787/dashboard`

接口文档：`http://127.0.0.1:8787/docs`

## 前端联调

本地配置：

```env
VITE_AGENT_API=http://127.0.0.1:8787
```

远程联调地址以 `docs/TEAM_HANDOFF.md` 中当前记录为准。

第一版主流程使用 `POST /battles`，展示 `attackerOut.samples` 和 `defenderOut`。

## 协作

```powershell
git pull
git checkout -b your-feature
git add .
git commit -m "describe your change"
git push -u origin your-feature
```

提交 Pull Request 到 `main`，不要提交 `.venv`、`.data`、日志、证书或私钥。

前端不需要修改 AIC、ACS、CAI 或 mTLS 配置。
