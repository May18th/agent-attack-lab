# 梧桐安装包构建边界

根据官方 `install-package-build.md`，安装包由 `acps-infra/release/install-packaging/scripts/build-install-package.sh` 统一组装。本项目当前不是 `acps-infra` 仓库，只有 FastAPI 后端、前端和本机开发脚本，因此不能在当前目录直接打出官方安装包。

## 两种模式

| 模式 | 必需输入 | 目标机器 | 产物 |
| --- | --- | --- | --- |
| `image` | app-release 包、匹配业务平台的 `*.image.tar.gz`、控制节点 CLI | 可运行 Docker 的 Linux | `acps-image-install-{version}-{platform}.tar` |
| `host` | app-release 包、按 `baseline-matrix.toml` 校验的 vendor bundle | Rocky 8/9 或 Ubuntu 20.04/22.04 | `acps-host-install-{version}-{platform}.tar` |

两种模式都需要 `acps-infra` 源码树和 `acps-cli-*-app-release-*.tar.gz`。`image` 还需要已构建的镜像包；`host` 还需要 vendor 文件和 SHA-256，或能访问官方下载源。

## 当前项目能做的部分

- 本地 Windows 开发继续使用 `backend/start.ps1`、`backend/restart.ps1` 和测试套件。
- 梧桐官方 wheel 与证书材料按 [`WUTONG_WHEEL_SETUP.md`](WUTONG_WHEEL_SETUP.md) 和 [`WUTONG_ACPS_CERT_SETUP.md`](WUTONG_ACPS_CERT_SETUP.md) 准备。
- 两个 Agent 技能包已经生成：`artifacts/attacker_agent.zip`、`artifacts/defender_agent.zip`。
- 生产安装、续签、信任链刷新、升级、回滚必须转到官方 Ansible 安装包和 inventory，不应把本机 PowerShell 脚本当成生产部署入口。

## 构建前必须由部署方确认

1. `acps-infra` 仓库版本与官方发布版本一致。
2. 应用发布包版本、业务平台（`linux-amd64` 或 `linux-arm64`）和控制节点平台。
3. 选择 `image` 还是 `host`；不要把两种模式的参数混用。
4. host 模式的 vendor URL、版本和 SHA-256 已按官方 matrix 校验。
5. 安装包构建完成后，使用包内 `ansible/site.yml` 部署，不能直接复制本项目 `.venv`、`.data`、`.env` 或证书。
