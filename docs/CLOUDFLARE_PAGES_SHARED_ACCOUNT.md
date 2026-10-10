# 在共同 Cloudflare 账号中创建 Pages 项目

本文说明如何让拥有私有 GitHub 仓库访问权的队友授权 Cloudflare Pages，同时把 Pages 项目创建在团队共同的 Cloudflare 账号中。这样不需要把 GitHub 仓库改为公开，也不会把项目绑定到队友个人的 Cloudflare 账号。

## 目标架构

```text
GitHub 私有仓库
  └─ 队友的 GitHub 账号授权 Cloudflare GitHub App
       └─ Pages 项目归属共同的 Cloudflare 账号

前端: https://yuanyiagentzhandui.cn
API:  https://api.yuanyiagentzhandui.cn
```

## 一、准备工作

开始前确认：

- 你和队友都能登录同一个 Cloudflare 账号；
- 该 Cloudflare 账号已经添加域名 `yuanyiagentzhandui.cn`；
- 队友的 GitHub 账号可以打开目标私有仓库，并且有读取仓库和提交状态的权限；
- 仓库中存在 `frontend/frontend-ui/package.json` 和 `frontend/frontend-ui/package-lock.json`；
- 后端 API 已经可以通过 `https://api.yuanyiagentzhandui.cn/health` 访问。

不要为了部署把私有仓库改成公开。仓库公开会暴露当前和未来提交历史中的源代码。

## 二、把队友加入共同 Cloudflare 账号

由共同 Cloudflare 账号的管理员操作：

1. 打开 Cloudflare 控制台的账号成员管理页面；
2. 邀请队友的 Cloudflare 登录邮箱；
3. 给队友授予 `Workers & Pages: Edit` 权限；
4. 如果需要由队友绑定自定义域名，再授予该域名的 DNS 编辑权限；
5. 不要直接授予不必要的完全管理员权限。

队友接受邀请后，在 Cloudflare 控制台右上角切换到共同账号。创建 Pages 项目时必须确认当前账号不是队友的个人 Cloudflare 账号。

## 三、由队友授权 GitHub 私有仓库

由于队友拥有目标私有仓库的访问权，建议由队友发起 GitHub 连接：

1. 在共同 Cloudflare 账号中打开 `Workers & Pages`；
2. 点击 `Create application`；
3. 选择 `Pages`；
4. 选择 `Connect to Git`，再选择 GitHub；
5. 队友登录并授权 Cloudflare Workers and Pages GitHub App；
6. 在 GitHub 的 App 设置中选择 `Only select repositories`；
7. 只勾选目标私有仓库，例如 `agent-attack-lab`；
8. 保存授权后返回 Cloudflare，刷新仓库列表。

如果仓库属于 GitHub Organization，组织管理员还需要在组织设置中允许 Cloudflare GitHub App 访问该仓库。`All repositories` 可以解决发现问题，但会扩大授权范围，不是首选。

GitHub 的协作者权限和 Cloudflare GitHub App 的授权范围是两层权限：队友能打开仓库，不代表 Cloudflare App 已经被允许读取这个仓库。两者都必须满足。

## 四、创建 Pages 项目

选择目标私有仓库后，填写以下构建设置：

```text
Project name:
agent-attack-lab-frontend

Production branch:
main

Root directory:
frontend/frontend-ui

Build command:
npm ci && npm run build

Build output directory:
dist
```

`dist` 是相对于 `frontend/frontend-ui` 的输出目录，不要填写 `frontend/frontend-ui/dist`。

在 Pages 项目的 `Settings -> Environment variables` 中，为 `Production` 添加：

```text
Name:  VITE_AGENT_API
Value: https://api.yuanyiagentzhandui.cn
```

如需预览部署，也可以在 `Preview` 环境添加相同变量或使用单独的测试 API 地址。`VITE_AGENT_API` 是构建时变量，修改后必须重新部署，刷新浏览器不会更新旧构建。

## 五、先用 Pages 临时域名验收

第一次部署成功后，先访问 Cloudflare 提供的 `*.pages.dev` 地址，确认：

- 页面能打开；
- 浏览器 Network 请求发往 `api.yuanyiagentzhandui.cn`；
- 创建一局攻防可以返回结果；
- 历史战局可以加载；
- 控制台没有 CORS、404 或 Mixed Content 错误。

如果构建失败，先检查构建日志中的工作目录、`npm ci`、Node.js 版本和 `dist` 输出路径。

## 六、绑定正式域名

在 Pages 项目的 `Custom domains` 中依次添加：

```text
yuanyiagentzhandui.cn
www.yuanyiagentzhandui.cn
```

域名和 Pages 必须位于同一个 Cloudflare 账号，DNS 记录按控制台提示创建。后端 API 保持独立：

```text
https://api.yuanyiagentzhandui.cn
```

不要把前端域名和 API 域名都指向同一个服务，也不要删除现有 API Tunnel 的 DNS 记录。

## 七、配置后端 CORS

后端需要允许正式前端域名。设置：

```powershell
$env:AGENT_CORS_ORIGINS="https://yuanyiagentzhandui.cn,https://www.yuanyiagentzhandui.cn"
```

然后重启 FastAPI。若后端通过 Windows 服务运行，不能只在临时 PowerShell 窗口设置变量；应把变量加入服务的启动环境或启动脚本，再重启服务。

验证 API：

```powershell
Invoke-RestMethod "https://api.yuanyiagentzhandui.cn/health"
```

响应应包含 `status` 为 `ok`，并且存储状态正常。

## 八、旧 Pages 项目的迁移

如果你已经创建了一个连接到错误 GitHub 账号的 Pages 项目：

1. 不要立即删除旧项目；
2. 在共同 Cloudflare 账号中按本文重新创建一个 Pages 项目；
3. 先用新的 `pages.dev` 地址完成构建和 API 验收；
4. 将正式域名从旧项目移除；
5. 将正式域名绑定到新项目；
6. 确认正式域名正常后，再决定是否删除旧项目。

如果控制台支持 `Disconnect Git`，也可以先断开旧连接，再重新授权队友的 GitHub App；但新建项目通常更容易回滚，也不会影响现有线上页面。

## 九、常见问题

### Cloudflare 中看不到私有仓库

检查当前 Cloudflare 账号是否为共同账号，并让队友重新配置 GitHub App 的 `Repository access`。如果仓库属于组织，联系组织管理员批准该 App。

### 无法通过 `Add GitHub account` 添加队友账号

Pages 的 GitHub 连接通常由一次 GitHub App/OAuth 授权管理，不一定支持在同一个连接界面长期添加多个 GitHub 账号。不要反复添加账号；让队友直接授权目标私有仓库，然后在共同 Cloudflare 账号内创建项目。

### 项目创建到了队友个人 Cloudflare 账号

不要直接迁移 DNS。先在共同 Cloudflare 账号创建并验收新项目，再切换自定义域名，避免出现域名已被另一个 Pages 项目占用的情况。

## 最终检查清单

- [ ] Pages 项目显示在共同 Cloudflare 账号；
- [ ] GitHub App 只授权了需要的私有仓库；
- [ ] 根目录为 `frontend/frontend-ui`；
- [ ] 构建命令为 `npm ci && npm run build`；
- [ ] 输出目录为 `dist`；
- [ ] `VITE_AGENT_API` 为 `https://api.yuanyiagentzhandui.cn`；
- [ ] `https://yuanyiagentzhandui.cn` 可以打开；
- [ ] `https://www.yuanyiagentzhandui.cn` 按预期跳转或打开；
- [ ] `https://api.yuanyiagentzhandui.cn/health` 返回正常；
- [ ] 浏览器没有 CORS 或 Mixed Content 错误；
- [ ] 没有把 Token、密钥、证书或 `.env` 文件提交到 Git。
