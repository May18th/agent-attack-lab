param(
    [string]$DatabasePath = "",
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Virtual environment not found. Run uv sync first."
}

if (-not $DatabasePath) {
    if ($env:AGENT_BATTLE_DATABASE_URL -like "postgresql://*" -or $env:AGENT_BATTLE_DATABASE_URL -like "postgres://*") {
        throw "当前配置使用 PostgreSQL，请使用 pg_dump；此脚本只备份 SQLite。"
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
