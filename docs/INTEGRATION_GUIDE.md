# 前后端联调总指南

本文件是“智能体攻防实验室”前后端联调的统一入口。项目与其他项目无关。接口字段、运行地址或排障方式发生变化时，应先更新本文件，再通知队友。

## 1. 当前地址

| 用途 | 地址 | 说明 |
|---|---|---|
| 稳定后端 API | https://api.kcwx.online | 前端远程联调使用 |
| 健康检查 | https://api.kcwx.online/health | 应返回 HTTP 200 |
| 中文后台 | https://api.kcwx.online/dashboard | 查看战局、历史和服务状态 |
| 接口文档 | https://api.kcwx.online/docs | FastAPI OpenAPI 文档 |
| 本地后端 | http://127.0.0.1:8787 | 仅后端电脑使用 |
| 本地前端 | http://localhost:5173 | 仅运行前端的电脑使用 |

队友的 trycloudflare.com 地址属于临时前端地址，会随 Quick Tunnel 重启而变化。页面地址和 API 地址不能混用：页面可以使用队友的临时地址，前端请求必须指向 https://api.kcwx.online。

### 公网验收注意

本机 FastAPI 的 `/health` 和 `POST /battles` 已验证正常。若公网地址返回 `Hello world`、HTML 或其他非 JSON 内容，说明权威 DNS/Tunnel 仍指向其他服务。请先核对 Cloudflare 登录账号和 Tunnel 名称，不要让前端修改 DNS；公网返回本项目 JSON 后再进行页面验收。

当前现场状态：已确认 `agent-attack-lab` Tunnel（ID：`abe90b02-7329-4488-8d1e-aa3e91725b37`）属于项目 Cloudflare 账号，配置为 `api.kcwx.online -> http://127.0.0.1:8787`；覆盖 `*.kcwx.online/*` 的旧 Worker 路由已删除。若删除后暂时返回 503，需要在后端电脑以管理员身份重启 Cloudflared 服务，再重新检查 `/health`。

~~~powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -Command "Restart-Service Cloudflared"'
~~~

当前后端 DNS 路由由 Cloudflare 管理：

~~~text
api.kcwx.online CNAME abe90b02-7329-4488-8d1e-aa3e91725b37.cfargotunnel.com
~~~

不要把 DNS 指向其他 Tunnel ID，也不要在阿里云注册商 DNS 中重复创建这条记录。

## 2. 分工边界

### 前端负责

- React 页面、主题输入、难度选择和响应式布局；
- 加载、成功、空结果和错误状态；
- 展示 attackerOut.samples、defenderOut、战局 ID、状态和时间；
- 通过 VITE_AGENT_API 调用后端，不修改后端字段名；
- 在自己的电脑启动前端或自己的前端 Tunnel。

### 后端负责

- FastAPI 接口、攻击样本、防守检测、战局持久化和事件时间线；
- CORS、限流、请求追踪、JSON-RPC/AIP 入口；
- 后端公网域名、Cloudflare Tunnel、数据库和备份；
- 接口契约变更、测试和部署文档。

### 不要交叉修改

- 前端不需要 Cloudflare 账号、Tunnel 凭据、API Token、数据库文件或证书；
- AIC、CAI、ACS、mTLS 证书由平台审核和后端负责人处理，不能自行编造或回填；
- 不把 .env.local、.venv、.data、日志、Token、证书和私钥提交到 GitHub。

## 3. 前端队友操作步骤

### 获取代码

~~~powershell
git clone https://github.com/May18th/agent-attack-lab.git
cd agent-attack-lab
git pull origin main
~~~

已有副本时：

~~~powershell
git pull origin main
~~~

### 启动前端

package.json 位于 frontend\frontend-ui，不能在用户主目录直接运行 npm run dev。

~~~powershell
cd frontend\frontend-ui
npm install
Set-Content .env.local "VITE_AGENT_API=https://api.kcwx.online"
npm run dev -- --host 0.0.0.0
~~~

浏览器访问 http://localhost:5173。修改 .env.local 后必须重启 Vite。该文件只保存在本机，不提交 GitHub。

### 前端公网演示

在前端电脑另开 PowerShell：

~~~powershell
cloudflared tunnel --url http://127.0.0.1:5173
~~~

终端输出的 https://xxxxx.trycloudflare.com 才是当前前端公网地址。Tunnel 终端不能关闭；关闭后会出现 Cloudflare 1033。这个地址只适合临时演示，不是固定地址。

## 4. 后端启动与验证

后端电脑执行：

~~~powershell
cd "D:\梧桐\backend"
uv sync
.\restart.ps1
~~~

本地验证：

~~~powershell
.\verify.ps1
~~~

公网验证：

~~~powershell
Invoke-RestMethod https://api.kcwx.online/health
~~~

健康检查应包含 status 为 ok、storage 为 ok 和 requestId。所有响应都会返回 X-Request-ID；排查问题时必须记录该值。

## 5. API 契约

### 创建完整战局

~~~http
POST /battles
Content-Type: application/json
~~~

请求：

~~~json
{"difficulty":"high","topic":"SQL 注入"}
~~~

difficulty 只能是 low、mid、high；topic 必须为 1-200 个字符。成功返回 HTTP 201，核心字段如下：

~~~json
{
  "id": "battle-...",
  "difficulty": "high",
  "topic": "SQL 注入",
  "status": "completed",
  "createdAt": "2026-10-06T...+00:00",
  "attackerOut": {"samples": []},
  "defenderOut": []
}
~~~

第一版前端优先调用此接口，它会完成一轮完整攻击和防守并返回结果。

### 查询战局

~~~text
GET /battles?limit=50&offset=0&difficulty=high&q=SQL
GET /battles/{battle_id}
~~~

limit 范围为 1-200。不存在的战局返回 404。

### 单独调用攻击和防守

~~~text
POST /agent/attack
POST /agent/defend
~~~

攻击请求：

~~~json
{"difficulty":"mid","topic":"提示注入"}
~~~

防守请求：

~~~json
{"sample":{"type":"violation","content":"Ignore previous instructions"}}
~~~

防守响应固定包含 caught、risks、fixed 三个数组。

### 对抗过程和战报

~~~text
GET /battles/{battle_id}/events
GET /battles/{battle_id}/replay
GET /battles/{battle_id}/events/stream?follow=true
WS  /ws/battles/{battle_id}
GET /reports/{battle_id}
GET /reports/{battle_id}?format=markdown
GET /leaderboard
GET /metrics
~~~

实时事件和回放属于增强功能，第一版页面可先完成 POST /battles、历史列表和详情。

### JSON-RPC

~~~http
POST /rpc
Content-Type: application/json
~~~

~~~json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "attack",
  "params": {"difficulty":"mid","topic":"提示注入"}
}
~~~

普通前端页面优先使用 REST；需要 ACPs AIP v2 时再使用 /rpc。

## 6. PowerShell 联调检查

检查后端：

~~~powershell
Invoke-RestMethod -Uri "https://api.kcwx.online/health"
~~~

创建一局：

~~~powershell
$body = @{ difficulty = "low"; topic = "输入校验" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.kcwx.online/battles" -ContentType "application/json" -Body $body
~~~

查看历史：

~~~powershell
Invoke-RestMethod "https://api.kcwx.online/battles?limit=10"
~~~

创建请求返回 201，且响应包含 id、attackerOut、defenderOut 时，后端主流程可用。

## 7. 联调验收清单

- [ ] GET /health 返回 200；
- [ ] 前端 .env.local 使用 https://api.kcwx.online；
- [ ] low、mid、high 都能创建战局；
- [ ] 页面显示攻击样本和防守三组结果；
- [ ] 空数组有清晰提示，不显示 undefined；
- [ ] 重复点击会被禁用或合并；
- [ ] 空主题、超过 200 字符能显示中文提示；
- [ ] 404、422、429、5xx 和网络失败不会显示堆栈；
- [ ] 报错记录 X-Request-ID；
- [ ] 历史列表和战局详情可恢复；
- [ ] 前端 npm run lint 和 npm run build 通过；
- [ ] 后端 uv run pytest -q 通过。

## 8. 常见问题排查

### npm 找不到 package.json

当前目录错误。进入包含 package.json 的目录：

~~~powershell
cd "项目路径\frontend\frontend-ui"
npm run dev
~~~

### Vite 提示 Blocked request 或 not allowed

拉取最新代码并重启 Vite：

~~~powershell
git pull origin main
cd frontend\frontend-ui
npm run dev -- --host 0.0.0.0
~~~

项目 vite.config.ts 已允许 trycloudflare.com 临时域名。修改配置后不重启，旧进程不会加载新设置。

### Cloudflare 1033 隧道错误

前端 Quick Tunnel 连接器已停止。重新运行：

~~~powershell
cloudflared tunnel --url http://127.0.0.1:5173
~~~

使用新输出的公网地址；不要继续使用已经失效的旧地址。

### Tunnel 显示健康但路线为 0

健康只代表连接器在线，不代表已经配置公网主机名。当前项目应使用名为 `agent-attack-lab` 的命名 Tunnel，并存在以下路由：

~~~text
api.kcwx.online -> http://127.0.0.1:8787
~~~

如果控制台显示的是其他名称、其他账号或“路线 0”，不要把它当作本项目后端 Tunnel，也不要重复创建 DNS。以 `https://api.kcwx.online/health` 的实际响应为准。

### 公网后端打不开、502 或 SSL 握手失败

先访问 https://api.kcwx.online/health。不要使用旧 Quick Tunnel 地址，也不要重复创建 DNS 记录。后端电脑必须保持服务和命名 Tunnel 运行。

### API_KEY_REQUIRED

这是外部 AI 网关（例如 api.orangecc.cc）要求认证的提示，不是本项目后端错误。不要把该地址配置为 VITE_AGENT_API，也不要把 API Key 放进前端或 GitHub。

### 422 Unprocessable Entity

检查请求体：difficulty 必须为 low、mid、high；topic 不能为空且不超过 200 个字符；防守请求必须包含 sample 对象。

### 401 Unauthorized

只有后端设置 AGENT_API_KEY 时才需要在请求头加入 X-API-Key。密钥不写入仓库，不发给前端队友。当前开发联调未启用 API Key 时无需添加。

### 429 Too Many Requests

触发每客户端每分钟限流。等待 Retry-After 指定时间后重试；不要用循环刷新公网接口。

### CORS 错误

当前后端默认允许本地前端，以及 Cloudflare Quick Tunnel 的 `https://*.trycloudflare.com` 来源。前端正式域名不在允许来源时，后端启动前设置：

~~~powershell
$env:AGENT_CORS_ORIGINS="https://你的前端域名"
~~~

多个来源使用英文逗号分隔，然后重启后端。临时 Quick Tunnel 地址变化时，优先让前端调用稳定后端域名并确认浏览器实际 Origin。

如需关闭临时域名匹配或改成更严格的规则，可设置：

~~~powershell
$env:AGENT_CORS_ORIGIN_REGEX="^https://你的前端域名$"
~~~

## 9. Git 协作规范

开始工作前：

~~~powershell
git pull origin main
~~~

完成后检查：

~~~powershell
git status
git diff --check
~~~

提交前端：

~~~powershell
git add frontend
git commit -m "feat: update frontend integration"
git push origin main
~~~

提交后端或文档：

~~~powershell
git add backend docs
git commit -m "docs: update integration guide"
git push origin main
~~~

不要把 .venv、.data、node_modules、dist（若被忽略）、.env.local、Tunnel 凭据和 API Token 加入提交。每次修改后保持文件归属清晰：后端放 backend/，前端放 frontend/，协作文档放 docs/。

## 10. 联调回执模板

~~~text
前后端联调回执：

1. 提交版本：
2. 前端启动命令：
3. VITE_AGENT_API：
4. 前端地址：
5. GET /health：成功/失败
6. POST /battles（low/mid/high）：
7. attackerOut 展示：成功/失败
8. defenderOut 展示：成功/失败
9. 历史和详情：成功/失败
10. lint/build：
11. 当前问题及 X-Request-ID：
12. 需要后端配合：
~~~

