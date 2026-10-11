# 智能体攻防实验室前端

React + TypeScript 前端控制台，连接后端战局、统计摘要和历史详情接口。

## 本地开发

```powershell
npm ci
$env:VITE_AGENT_API = "http://127.0.0.1:8787"
npm run dev
```

默认页面为 `http://localhost:5173/`。跨电脑联调时，将 `VITE_AGENT_API` 设置为队友提供的后端 HTTPS 地址；不要把 API 密钥写进公开前端环境变量。

正式公网访问由 Cloudflare Access 和后端校验完成。前端不提供密码输入框、不保存 API Key；未通过组织认证时只显示认证状态与重新检查按钮。

## 校验

```powershell
npm test
npm run lint
npm run build
```

## 页面地址参数

- `?topic=订单查询权限校验&difficulty=high`：预填测试主题和难度。
- `?battle_id=<战局编号>`：直接打开历史战局；刷新后保留当前战局。

历史列表使用后端 `limit/offset` 分页；搜索由后端 `q` 筛选，分页总数读取 `X-Total-Count`。统计卡来自 `GET /dashboard/summary`，规则库本地模拟用例、已保存样本、规则命中、风险记录使用各自口径。

首页外部案例区域调用只读 `GET /external-cases`，展示 CVE、来源发布方、目录版本和内容哈希前缀；外部案例不会被当作项目战局或真实事件。后端未导入案例库时会明确显示不可用状态。
