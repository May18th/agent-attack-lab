# Git 敏感文件防护

提交前检查暂存区：

```powershell
cd "D:\梧桐\backend"
uv run python scripts/check_sensitive_files.py --staged
```

CI 默认检查所有 Git 已跟踪文件。以下材料禁止进入仓库：

- `.env`、证书、私钥、EAB、Token 和本地备份；
- 数据库、日志、JSONL 数据集和私有 wheel；
- `backend/.acps-cli/`、`backend/keyfiles/`、`backend/packages/` 和本地 `.data/`。

`.env.example`、`.env.sample` 和 `.env.template` 只允许保存占位符。检查脚本只读取 Git 跟踪或暂存路径，不会处理、上传或删除其他未跟踪文件。
