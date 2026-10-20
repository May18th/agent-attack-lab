# 项目长期部署记录

## 2026-10-20

- 前端项目：`frontend/frontend-ui`
- Cloudflare 产品：Workers Static Assets
- Worker：`agent-attack-lab`
- Cloudflare 账号：`2166883736@qq.com's Account`
- Account ID：`434bfd2a8e4ae5b35caf32b2f2993147`
- 生产 API：`https://api.yuanyiagentzhandui.cn`
- 发布版本：`85eb5726-a575-4790-b748-893eb777d56e`
- Worker 地址：`https://agent-attack-lab.2166883736.workers.dev`
- Pages 地址：`https://agent-attack-lab.pages.dev`
- 发布验证：Worker 与 Pages 首页均返回 HTTP 200

## 长期约束

- 管理员后台只使用管理员密码建立安全会话，不接入 Cloudflare Access 身份认证。
- 3D 战局节点位置与既有链路保持稳定；节点点击必须驱动右侧结构化详情面板。
- 缺失的后端数据必须显示“未记录/评分不足”，不得生成模拟分数或虚构设备信息。
- 生产部署使用项目内 Wrangler，发布前执行生产构建与测试。
- 所有进度必须先核对本地文件与 Git 状态，完成提交并推送到远端后，才能部署云端；云端发布后必须核对正式域名实际绑定的 Cloudflare 账户/Worker、清理对应路径缓存，并做公网复验。

## 2026-10-21 发布补充

- 正式域名 `yuanyiagentzhandui.cn/*` 实际绑定 Cloudflare 账号 `5ae15bce614603a1748af32e96515395` 下的 `agent-attack-lab` Worker；账号 `434bfd2a8e4ae5b35caf32b2f2993147` 的同名 Worker 仅作为另一发布目标，不能据此判断正式域名已更新。
- 发布顺序：Git 核对/提交/推送 → 生产构建 → 使用目标账号部署 → 单 URL 清理 `/admin` 缓存 → 访问正式域名检查构建资源与 `/auth/session`。
