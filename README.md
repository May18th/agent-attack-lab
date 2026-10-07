# 智能体攻防实验室

这是独立的智能体攻防实验室项目。

## 目录

- `backend/`：FastAPI 后端、Agent 逻辑和测试
- `frontend/`：前端源码和前端联调材料；队友的实际前端项目应放在这里
- `docs/`：接口契约与协作规则

完整结构：

```text
D:\梧桐
├─ backend
│  ├─ src              后端源码
│  ├─ tests            后端测试
│  ├─ .venv            本机运行环境，不提交
│  └─ .data            SQLite 和运行日志，不提交
├─ frontend            前端源码与前端材料
├─ docs                统一交接、边界和接口文档
├─ README.md           项目入口
└─ .gitignore          忽略规则
```

不要把源码、临时日志、虚拟环境或数据库放到项目根目录；前后端文件分别放入对应目录。

协作边界详见 `docs/COLLABORATION_BOUNDARIES.md`；前后端联调、启动和排障详见 `docs/INTEGRATION_GUIDE.md`。

前端队友当前待办详见 `frontend/FRONTEND_TODO.md`，请先完成文件顶部的“当前优先待办”。

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

远程联调统一使用 `https://api.kcwx.online`，完整步骤见 `docs/INTEGRATION_GUIDE.md`。

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
