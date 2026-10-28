# 06 部署说明与脱敏清单（对应清单第 12 项）

> 目标：让评委能判断"这套东西是真能部署起来的"，同时不泄露凭据。

## 一、部署方式

不是手工 scp，而是流水线：

```
合并到 main
  → GitHub Actions（deploy-backend.yml）
  → self-hosted runner（跑在目标 VPS 上，账号 deployer）
  → backend/scripts/deploy-production.sh
  → 逐服务 systemctl --user restart
```

关键设计：**运行时目录跨版本保留**。部署脚本对 `.env .data .venv .wit .acps-cli keyfiles packages acps`
做软链，新版本发布不会覆盖配置与数据：

```bash
for runtime_entry in .env .data .venv .wit .acps-cli keyfiles packages acps; do
  # 从旧 release 链接到新 release
done
```

效果：问卷数据、证书、密钥、虚拟环境都不随发版丢失。实测部署耗时约 20 秒，
干净环境首次部署约 4 分钟。

## 二、依赖

| 层 | 依赖 | 版本 |
|---|---|---|
| 后端运行时 | Python | 3.14（生产）；CI 用公共索引版本 |
| 平台 SDK | `acps-sdk` | 生产 2.2.0（私有包）；CI 2.1.0 |
| 平台运行时 | `wit-framework` | 2.1.0 |
| Web 框架 | FastAPI / uvicorn | ≥0.110 / ≥0.29 |
| 数据 | PyMySQL、psycopg[binary,pool]、redis、alembic | 见 `pyproject.toml` |
| 心跳 | kafka-python（直投平台 Kafka） | ≥3.0 |
| 前端 | Node + Vite + React | 见 `frontend/frontend-ui/package.json` |

## 三、配置项（只列键名，值不在仓库内）

配置文件：`/opt/agent-attack-lab/backend/.env`（600 权限，不进仓库、不进 CI 日志）。

| 键 | 作用 | 是否可公开 |
|---|---|---|
| `AGENT_LLM_API_KEY` | 模型调用密钥 | **否** |
| `AGENT_AMP_AIC` | 心跳上报身份 | 是（AIC 公开） |
| `AGENT_AIP_LEADER_ID` | 主调度对端身份 | 是（AIC 公开） |
| `AGENT_SURVEY_STORE` | 问卷落盘路径 | 是 |
| `AGENT_API_KEY` | 管理接口鉴权 | **否** |
| 数据库连接串 | MySQL/Postgres | **否** |

部署流水线里的 `upsert` 逻辑会在每次发布时校正身份变量，避免换 AIC 后 `.env` 里
还留着旧身份（2026-10-26 实际踩过：三个服务仍用两轮前的 AIC，调用带的对端身份是错的）。

## 四、启动步骤（从零复现）

```bash
# 1. 后端
cd backend
python -m venv .venv && ./.venv/Scripts/pip install -e .   # Linux: .venv/bin/pip
# 平台私有包需按授权单独安装 acps-sdk 2.2.0 / wit-framework 2.1.0
./.venv/Scripts/python.exe -m uvicorn agent_attack_lab.service:app --host 0.0.0.0 --port 8000

# 2. 前端
cd frontend/frontend-ui
npm ci && npm run build:production

# 3. 自检
curl -s localhost:8000/health
curl -s "localhost:8000/battles?limit=1"
```

`/health` 返回正常即表示服务层就绪；`/battles` 可读表示数据层就绪。

## 五、脱敏清单（交材料前逐条过）

| 对象 | 处理 |
|---|---|
| `.env` 全文 | 不出现。只列键名 |
| `AGENT_LLM_API_KEY` / `AGENT_API_KEY` | 不出现，截图需打码 |
| 客户端证书私钥（`*.key`） | 不出现 |
| 证书序列号 / SAN 明细 | 可写"AIC 匹配、链完整"，不贴证书全文 |
| `registrationId` | 建议不写（内部标识，无展示价值） |
| 服务器公网 IP | 截图打码；文档里用域名 |
| 数据库连接串 | 不出现 |
| 问卷导出 CSV | 只给汇总统计，不给原始行（含 IP 与 UA） |
| 战局详情里的 `client_ip` | 不贴 |

可公开且应写进材料的：**AIC 标识、域名、战局编号、`agentSource`、时间戳、测试通过数**。

## 六、这一项的缺口

- 还差一份"从空机器到跑起来"的完整命令记录（当前 `DEPLOYMENT.md` 偏运维交接，不是复现指南）。
  建议按 §四 实跑一次并录屏，作为附录。
