# 智能体攻防实验室前端

React + TypeScript 前端控制台，连接后端战局、统计摘要和历史详情接口。

## 本地开发

```powershell
npm ci
$env:VITE_AGENT_API = "http://127.0.0.1:8787"
npm run dev
```

默认页面为 `http://localhost:5173/`。跨电脑联调时，将 `VITE_AGENT_API` 设置为队友提供的后端 HTTPS 地址；不要把 API 密钥写进公开前端环境变量。

正式公网前端面向公众，无需 Cloudflare Access 或浏览器登录。前端不保存 API Key；后台管理页和内部接口继续由后端鉴权。公开业务 API 及匿名战局创建限流规则见 `docs/FRONTEND_TO_BACKEND_HANDOFF.md`。

## 校验

```powershell
npm test
npm run lint
npm run build
```

## Preview 隔离构建

公开 Preview 必须使用独立的 HTTPS API 和测试数据库，不能指向正式 API 或访问者本机。
准备好隔离环境后，可参考 `preview.env.example` 设置构建环境的 `VITE_AGENT_API`，再运行：

```powershell
$env:VITE_AGENT_API = "https://preview-api.example.com"
npm run build:preview
```

`build:preview` 会拒绝缺失配置、HTTP、本机地址和正式 API。若公开域名构建时没有显式配置
`VITE_AGENT_API`，前端会停止请求并显示未配置隔离 API，不会尝试访问访问者的
`127.0.0.1`。

## 页面地址参数

- `?topic=订单查询权限校验&difficulty=high`：预填测试主题和难度。
- `?battle_id=<战局编号>`：直接打开历史战局；刷新后保留当前战局。

历史列表使用后端 `limit/offset` 分页；搜索由后端 `q` 筛选，分页总数读取 `X-Total-Count`。统计卡来自 `GET /dashboard/summary`，规则库本地模拟用例、已保存样本、规则命中、风险记录使用各自口径。

首页外部案例区域调用只读 `GET /external-cases`，展示 CVE、来源发布方、目录版本和内容哈希前缀；外部案例不会被当作项目战局或真实事件。后端未导入案例库时会明确显示不可用状态。
