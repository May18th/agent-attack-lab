# 梧桐技能包上传

已准备两个独立 Agent 的本地技能包源目录：

```text
skill_packages/attacker_agent/
├── skill.md
└── resources/
    └── api_contract.md

skill_packages/defender_agent/
├── skill.md
└── resources/
    └── output_contract.md
```

平台发布页要求“技能包名称”和 ZIP 文件名一致。项目会生成两个 ZIP：

```text
artifacts/attacker_agent.zip
artifacts/defender_agent.zip
```

上传前检查：

1. 发布攻击方时，技能包名称填写 `attacker_agent`，选择 `artifacts/attacker_agent.zip`。
2. 发布防守方时，技能包名称填写 `defender_agent`，选择 `artifacts/defender_agent.zip`。
3. 确认每个包内只有对应的 `skill.md` 和 `resources/output_contract.md` 等说明文件。
4. 不上传 `.env`、API Key、Token、AIC、EAB、证书、私钥、数据库和日志。
5. 提交后等待平台管理员审核；审核通过才代表技能包发布，不代表后端公网或 mTLS 已验收。

重新生成 ZIP：

```powershell
New-Item -ItemType Directory -Force .\artifacts | Out-Null
Remove-Item .\artifacts\attacker_agent.zip, .\artifacts\defender_agent.zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path .\skill_packages\attacker_agent\* -DestinationPath .\artifacts\attacker_agent.zip -CompressionLevel Optimal
Compress-Archive -Path .\skill_packages\defender_agent\* -DestinationPath .\artifacts\defender_agent.zip -CompressionLevel Optimal
```
