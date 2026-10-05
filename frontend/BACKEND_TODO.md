# 后端待办清单

## P0 必须完成

| 编号 | 待办 | 对接前端 | 验收标准 |
|---|---|---|---|
| BE-01 | 固化 POST /battles 请求与响应并更新 OpenAPI | FE-03、FE-05、FE-08 | 返回 id/difficulty/topic/status/createdAt/attackerOut/defenderOut |
| BE-02 | 固化校验和错误结构 | FE-04、FE-09 | difficulty 只允许 low/mid/high，topic 上限 200，422 不泄露堆栈 |
| BE-03 | 保证攻击样本结构和难度行为 | FE-06 | 字段和样本行为符合交接文档并有测试 |
| BE-04 | 保证防守结果结构 | FE-07 | caught、risks、fixed 始终为数组 |
| BE-05 | 保证一轮攻防完整执行 | FE-05、FE-08 | 完成攻击和防守后才返回 completed |
| BE-06 | 稳定历史列表和详情接口 | FE-11、FE-12 | 列表可排序，未知 ID 返回 404 |
| BE-07 | 配置本地和公网 CORS | FE-02、FE-10 | 本地和公网前端均可请求 |
| BE-08 | 补齐自动化测试并通过 verify.ps1 | FE-09、FE-16 | 覆盖 health、battles、404、422、defend、RPC 和持久化 |
| BE-09 | 更新 /docs 和 Markdown 交接文档 | FE-03、FE-10 | 字段、样例、状态码和地址与实际一致 |

## P1 应完成

| 编号 | 待办 | 对接前端 |
|---|---|---|
| BE-10 | 优化历史查询，预留 limit 或分页 | FE-11、FE-12 |
| BE-11 | 增强 /health 状态信息 | FE-13 |
| BE-12 | 增加统一请求日志关联 | FE-10，后续实时功能 |
| BE-13 | 预留 arbiter 扩展边界 | FE-P2 |
| BE-14 | 编写公网服务运行手册 | FE-10、演示录制 |

## P2 后续扩展

- AIP 双向通信和 AMP 日志生产化。
- WebSocket /ws/battles/{battle_id}。
- arbiter、score、round、connected 事件。
- PostgreSQL/ORM 迁移评估。

## 前后端接应节点

| 节点 | 前端交付 | 后端同步交付 | 联调输出 |
|---|---|---|---|
| N1 工程可运行 | FE-01、FE-02：工程和环境变量 | BE-07：本地和公网 CORS | 前端启动并访问 /health |
| N2 API 可调用 | FE-03、FE-04：客户端和输入校验 | BE-01、BE-02、BE-09：契约、错误和文档 | 同一份请求和响应样例 |
| N3 主流程贯通 | FE-05 至 FE-08：提交和结果展示 | BE-03 至 BE-05：攻击、防守和战局编排 | low/high 完整战况截图或录屏 |
| N4 异常可验收 | FE-09：错误状态展示 | BE-02、BE-08：错误格式和自动化测试 | 422、404、5xx、网络失败检查表 |
| N5 历史与恢复 | FE-11、FE-12：列表和详情 | BE-06、BE-10：列表、详情和查询优化 | 创建、列表、详情、刷新恢复闭环 |
| N6 演示冻结 | FE-10、FE-15、FE-16：联调、布局和测试 | BE-08、BE-09、BE-14：测试、文档和运行手册 | 最终演示版本和验收记录 |

