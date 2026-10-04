param(
    [int]$Port = 8787,
    [switch]$Reload
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
    $Python = Join-Path (Split-Path -Parent $ProjectRoot) ".venv\Scripts\python.exe"
}

if (-not (Test-Path -LiteralPath $Python)) {
    throw "未找到虚拟环境：$Python。请先在 backend 目录执行 uv sync。"
}

Set-Location -LiteralPath $ProjectRoot
$Arguments = @("-m", "uvicorn", "agent_attack_lab.service:app", "--host", "0.0.0.0", "--port", "$Port")
if ($Reload) { $Arguments += "--reload" }
& $Python @Arguments
