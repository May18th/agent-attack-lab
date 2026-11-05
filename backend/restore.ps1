param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,
    [string]$DatabasePath = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
# 固定进程工作目录：脚本用 [IO.Path]::GetFullPath 解析相对路径，它依赖进程 CWD，
# 而不是 PowerShell 的当前位置。不固定的话，相对 -DatabasePath 会落到启动目录里。
[Environment]::CurrentDirectory = $ProjectRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Virtual environment not found. Run uv sync first."
}

# 应用配置放在 backend\.env 里。不加载它的话，本脚本读不到 AGENT_BATTLE_DATABASE_URL，
# 会误判成 SQLite 模式去恢复一个已经不再使用的历史文件。
# 仅在该变量尚未存在于进程环境时加载，保证真实环境变量优先级更高。
$EnvFile = Join-Path $ProjectRoot ".env"
if (-not $env:AGENT_BATTLE_DATABASE_URL -and (Test-Path -LiteralPath $EnvFile)) {
    Get-Content -LiteralPath $EnvFile -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $key = $parts[0].Trim()
            $value = $parts[1].Trim().Trim('"').Trim("'")
            if ($key -and -not [Environment]::GetEnvironmentVariable($key, "Process")) {
                [Environment]::SetEnvironmentVariable($key, $value, "Process")
            }
        }
    }
}
if (-not (Test-Path -LiteralPath $BackupPath)) {
    throw "Backup not found: $BackupPath"
}
if (-not $DatabasePath) {
    if ($env:AGENT_BATTLE_DATABASE_URL -like "postgresql://*" -or $env:AGENT_BATTLE_DATABASE_URL -like "postgres://*") {
        throw "当前配置使用 PostgreSQL，请使用 pg_restore；此脚本只恢复 SQLite 和 MySQL。"
    }
    if ($env:AGENT_BATTLE_DATABASE_URL -like "mysql://*" -or $env:AGENT_BATTLE_DATABASE_URL -like "mysql+pymysql://*") {
        # MySQL 恢复会 DROP 并重建表，先无条件留一份当前数据快照，避免误操作不可逆。
        $safetyBackupDirectory = Join-Path $ProjectRoot ".data\backups"
        New-Item -ItemType Directory -Force -Path $safetyBackupDirectory | Out-Null
        $safetyBackup = Join-Path $safetyBackupDirectory ("pre-restore-{0}.sql" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
        & $Python (Join-Path $ProjectRoot "scripts\db_backup_mysql.py") dump --url $env:AGENT_BATTLE_DATABASE_URL --output $safetyBackup
        if ($LASTEXITCODE -ne 0) { throw "恢复前自动备份当前 MySQL 数据失败，已中止恢复。" }
        Write-Host "Safety backup created: $safetyBackup"

        & $Python (Join-Path $ProjectRoot "scripts\db_backup_mysql.py") restore --url $env:AGENT_BATTLE_DATABASE_URL --input $BackupPath
        if ($LASTEXITCODE -ne 0) {
            throw "MySQL restore failed. 恢复前快照：$safetyBackup"
        }
        Write-Host "Database restored: $BackupPath"
        return
    }
    $DatabasePath = if ($env:AGENT_BATTLE_DB) { $env:AGENT_BATTLE_DB } else { Join-Path $ProjectRoot ".data\battles.sqlite3" }
}
if ((Test-Path -LiteralPath $DatabasePath) -and -not $Force) {
    throw "Target exists. Stop the backend and rerun with -Force to replace it: $DatabasePath"
}

$env:ATTACK_LAB_BACKUP_SOURCE = (Resolve-Path -LiteralPath $BackupPath).Path
$env:ATTACK_LAB_BACKUP_TARGET = [IO.Path]::GetFullPath($DatabasePath)
$targetDirectory = Split-Path -Parent $env:ATTACK_LAB_BACKUP_TARGET
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
& $Python -c "import os, sqlite3; source=os.environ['ATTACK_LAB_BACKUP_SOURCE']; target=os.environ['ATTACK_LAB_BACKUP_TARGET']; src=sqlite3.connect(source); dst=sqlite3.connect(target); src.backup(dst); dst.close(); src.close(); print(target)"
if ($LASTEXITCODE -ne 0) { throw "SQLite restore failed." }
Write-Host "Database restored: $DatabasePath"
