param(
    [int]$Port = 8787,
    [switch]$Reload
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvLoader = Join-Path $ProjectRoot "scripts\load-env.ps1"
if (Test-Path -LiteralPath $EnvLoader) { & $EnvLoader -ProjectRoot $ProjectRoot }
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
    $Python = Join-Path (Split-Path -Parent $ProjectRoot) ".venv\Scripts\python.exe"
}

if (-not (Test-Path -LiteralPath $Python)) {
    throw "未找到虚拟环境：$Python。请先在 backend 目录执行 uv sync。"
}

if ([string]::IsNullOrWhiteSpace($env:AGENT_ATTACKER_RPC_URL)) {
    $env:AGENT_ATTACKER_RPC_URL = "http://127.0.0.1:8788/rpc"
}
if ([string]::IsNullOrWhiteSpace($env:AGENT_DEFENDER_RPC_URL)) {
    $env:AGENT_DEFENDER_RPC_URL = "http://127.0.0.1:8789/rpc"
}
& (Join-Path $ProjectRoot "stop-agents.ps1")
& (Join-Path $ProjectRoot "start-agents.ps1")

Set-Location -LiteralPath $ProjectRoot
$Arguments = @("-m", "uvicorn", "agent_attack_lab.service:app", "--host", "0.0.0.0", "--port", "$Port")
if ($Reload) { $Arguments += "--reload" }
& $Python @Arguments
