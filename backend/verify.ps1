$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $Python)) {
    throw 'Virtual environment not found. Run uv sync first.'
}

Set-Location -LiteralPath $ProjectRoot
& $Python -m pytest -q

$health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
if ($health.status -ne 'ok') {
    throw 'Health check failed.'
}

Write-Host 'Backend verification passed.'
