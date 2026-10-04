$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $Python)) {
    $Python = Join-Path (Split-Path -Parent $ProjectRoot) '.venv\Scripts\python.exe'
}
$Port = 8787

if (-not (Test-Path -LiteralPath $Python)) {
    throw 'Virtual environment not found. Run uv sync first.'
}

$oldProcesses = Get-CimInstance Win32_Process | Where-Object {
    ($_.CommandLine -like '*agent_attack_lab.service:app*') -and
    (($_.CommandLine -like '*--port 8787*') -or ($_.CommandLine -like '*--port=8787*'))
}

foreach ($process in $oldProcesses) {
    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
}

Set-Location -LiteralPath $ProjectRoot
$LogDirectory = Join-Path $ProjectRoot '.data'
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$StandardOutput = Join-Path $LogDirectory 'server.out.log'
$StandardError = Join-Path $LogDirectory 'server.err.log'

Start-Process -FilePath $Python -ArgumentList @(
    '-m', 'uvicorn', 'agent_attack_lab.service:app',
    '--host', '127.0.0.1', '--port', "$Port"
) -WorkingDirectory $ProjectRoot -WindowStyle Hidden `
    -RedirectStandardOutput $StandardOutput -RedirectStandardError $StandardError

Write-Host "Service started at http://127.0.0.1:$Port"
