param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,
    [string]$DatabasePath = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Virtual environment not found. Run uv sync first."
}
if (-not (Test-Path -LiteralPath $BackupPath)) {
    throw "Backup not found: $BackupPath"
}
if (-not $DatabasePath) {
    if ($env:AGENT_BATTLE_DATABASE_URL -like "postgresql://*" -or $env:AGENT_BATTLE_DATABASE_URL -like "postgres://*") {
        throw "当前配置使用 PostgreSQL，请使用 pg_restore；此脚本只恢复 SQLite。"
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
