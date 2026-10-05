# 前端待办清单

## P0 必须完成

| 编号 | 待办 | 后端依赖 | 验收标准 |
|---|---|---|---|
| FE-01 | 将 React + TypeScript 工程整理到 frontend/ | 无 | npm install 和 npm run dev 可启动 |
| FE-02 | 配置 .env.example 和 .env.local | VITE_AGENT_API | 切换本地/公网后端只改环境变量 |
| FE-03 | 建立统一 API 客户端和类型 | /battles 契约 | 统一处理请求、状态和网络错误 |
| FE-04 | 完成主题输入和难度选择 | low/mid/high；topic 最大 200 字符 | 空值、超长、重复提交有提示 |
| FE-05 | 接入 POST /battles | id/status/createdAt/attackerOut/defenderOut | low、mid、high 各成功创建一局 |
| FE-06 | 展示 attackerOut.samples | type/topic/severity/content | 列表、空数组和长文本正常展示 |
| FE-07 | 展示 defenderOut.caught/risks/fixed | 三组数组 | 三组结果可展示，空数组有状态 |
| FE-08 | 展示战局 ID、状态、创建时间 | 元信息字段 | 能确认当前战局身份 |
| FE-09 | 处理加载、成功、空结果、422、404、5xx、网络失败 | 稳定状态码和错误结构 | 中文提示清晰，不显示堆栈 |
| FE-10 | 完成首轮联调 | 后端服务、CORS、固定样例 | 从输入到完整战况连续跑通 |

## P1 应完成

| 编号 | 待办 | 后端依赖 |
|---|---|---|
| FE-11 | 历史战局列表 | GET /battles |
| FE-12 | 战局详情恢复 | GET /battles/{battle_id} |
| FE-13 | 健康状态提示 | GET /health |
| FE-14 | 样本和错误文本安全展示 | 纯文本渲染 |
| FE-15 | 响应式演示布局 | 桌面和窄屏不溢出 |
| FE-16 | API、表单和结果区测试 | 成功、空结果、422、5xx、网络失败 |

## P2 后续扩展

- /rpc 调试入口。
- WebSocket 实时战况。
- arbiter、score、round、correlationId 和事件时间线。
- 战局导出、比较和筛选。

## 前后端接应节点

| 节点 | 前端交付 | 后端同步交付 | 联调输出 |
|---|---|---|---|
| N1 工程可运行 | FE-01、FE-02 | BE-07：本地和公网 CORS | 前端启动并访问 /health |
| N2 API 可调用 | FE-03、FE-04 | BE-01、BE-02、BE-09：契约、错误和文档 | 同一份请求和响应样例 |
| N3 主流程贯通 | FE-05 至 FE-08 | BE-03 至 BE-05：攻击、防守和战局编排 | low/high 完整战况截图或录屏 |
| N4 异常可验收 | FE-09 | BE-02、BE-08：错误格式和自动化测试 | 422、404、5xx、网络失败检查表 |
| N5 历史与恢复 | FE-11、FE-12 | BE-06、BE-10：列表、详情和查询优化 | 创建、列表、详情、刷新恢复闭环 |
| N6 演示冻结 | FE-10、FE-15、FE-16 | BE-08、BE-09、BE-14：测试、文档和运行手册 | 最终演示版本和验收记录 |

