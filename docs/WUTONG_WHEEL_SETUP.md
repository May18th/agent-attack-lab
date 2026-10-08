# 梧桐 Wheel 安装准备

项目当前使用 Python 3.14。梧桐手册要求安装以下官方发行包：

- `acps_sdk-2.2.0-py3-none-any.whl`
- `wit_framework-2.1.0-cp312.cp313.cp314-none-any.whl`
- `release-manifest.json`

由于 `wit-framework` 不在公共 Python 软件源，不能用普通 `pip install wit-framework` 替代。请从梧桐平台发行页面下载后，将两个文件放入：

```text
D:\梧桐\backend\packages\
```

然后在 PowerShell 执行：

```powershell
cd "D:\梧桐\backend"
.\scripts\install_wit_wheels.ps1
```

脚本会使用后端现有 `.venv`，按 SDK → wit 顺序安装两个 wheel，然后执行 `wit-release-preflight --manifest release-manifest.json`，最后检查 `acps_sdk` 与 `wit` 是否可导入。预检会校验发行版本、相邻文件哈希、导入来源和 AIP SQLite 持久化。发行文件只保留在本机，不提交 GitHub。

安装完成后，下一步由注册脚本生成攻击/防守 ACS 草稿并执行 `up_until_ready()`。梧桐账号、密码、验证码和人工审核仍由用户在本机完成，密码不写入仓库。
