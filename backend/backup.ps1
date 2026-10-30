param(
    [string]$DatabasePath = "",
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
# 固定进程工作目录：脚本用 [IO.Path]::GetFullPath 解析相对路径，它依赖进程 CWD，
# 而不是 PowerShell 的当前位置。不固定的话，相对 -OutputPath 会落到启动目录里。
[Environment]::CurrentDirectory = $ProjectRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Virtual environment not found. Run uv sync first."
}

# 应用配置放在 backend\.env 里。不加载它的话，本脚本读不到 AGENT_BATTLE_DATABASE_URL，
# 会误判成 SQLite 模式去备份一个已经不再写入的历史文件。
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

if (-not $DatabasePath) {
    if ($env:AGENT_BATTLE_DATABASE_URL -like "postgresql://*" -or $env:AGENT_BATTLE_DATABASE_URL -like "postgres://*") {
        throw "当前配置使用 PostgreSQL，请使用 pg_dump；此脚本只备份 SQLite 和 MySQL。"
    }
    if ($env:AGENT_BATTLE_DATABASE_URL -like "mysql://*" -or $env:AGENT_BATTLE_DATABASE_URL -like "mysql+pymysql://*") {
        if (-not $OutputPath) {
            $mysqlBackupDirectory = Join-Path $ProjectRoot ".data\backups"
            New-Item -ItemType Directory -Force -Path $mysqlBackupDirectory | Out-Null
            $OutputPath = Join-Path $mysqlBackupDirectory ("battles-{0}.sql" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
        }
        & $Python (Join-Path $ProjectRoot "scripts\db_backup_mysql.py") dump --url $env:AGENT_BATTLE_DATABASE_URL --output $OutputPath
        if ($LASTEXITCODE -ne 0) { throw "MySQL backup failed." }
        if (-not (Test-Path -LiteralPath $OutputPath)) { throw "MySQL backup produced no file: $OutputPath" }
        Write-Host "Backup created: $OutputPath"
        return
    }
    $DatabasePath = if ($env:AGENT_BATTLE_DB) { $env:AGENT_BATTLE_DB } else { Join-Path $ProjectRoot ".data\battles.sqlite3" }
}
if ($DatabasePath -eq ":memory:") {
    throw "Cannot back up an in-memory database."
}
if (-not (Test-Path -LiteralPath $DatabasePath)) {
    throw "Database not found: $DatabasePath"
}
if (-not $OutputPath) {
    $backupDirectory = Join-Path $ProjectRoot ".data\backups"
    New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
    $OutputPath = Join-Path $backupDirectory ("battles-{0}.sqlite3" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
}

$env:ATTACK_LAB_BACKUP_SOURCE = (Resolve-Path -LiteralPath $DatabasePath).Path
$env:ATTACK_LAB_BACKUP_TARGET = [IO.Path]::GetFullPath($OutputPath)
& $Python -c "import os, sqlite3; source=os.environ['ATTACK_LAB_BACKUP_SOURCE']; target=os.environ['ATTACK_LAB_BACKUP_TARGET']; os.makedirs(os.path.dirname(target), exist_ok=True); src=sqlite3.connect(source); dst=sqlite3.connect(target); src.backup(dst); dst.close(); src.close(); print(target)"
if ($LASTEXITCODE -ne 0) { throw "SQLite backup failed." }
Write-Host "Backup created: $OutputPath"
