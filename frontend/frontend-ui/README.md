# 智能体攻防实验室前端

这是攻防实验室的 React 控制台，连接后端的战局、事件、回放和 Markdown 战报接口。

## 启动

在 `frontend/frontend-ui` 目录执行：

```powershell
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

本地开发时 Vite 会把 `/health`、`/battles`、`/reports` 等请求代理到 `http://127.0.0.1:8787`。

跨电脑或公网部署时，设置 `VITE_AGENT_API` 为后端公网地址，例如：

```powershell
$env:VITE_AGENT_API = "https://你的后端域名"
npm run dev -- --host 0.0.0.0 --port 5173
```

构建检查：

```powershell
npm run build
```

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
