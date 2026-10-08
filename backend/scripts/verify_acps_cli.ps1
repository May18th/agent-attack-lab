param(
    [string]$CliPath = "",
    [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"

$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($CliPath)) {
    $CliPath = Join-Path $backendRoot "..\tools\ACPs-community\acps-cli\.venv\Scripts\acps-cli.exe"
}
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $backendRoot "acps-cli.toml"
}

if (-not (Test-Path -LiteralPath $CliPath -PathType Leaf)) {
    throw "未找到 acps-cli：$CliPath。请安装梧桐官方 CLI，或用 -CliPath 指定可执行文件。"
}
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "未找到配置：$ConfigPath。请先复制 backend/acps-cli.toml.example。"
}

$config = Get-Content -Raw -LiteralPath $ConfigPath
foreach ($required in @(
    'https://wt.ioa.pub/registry-server',
    'https://wt.ioa.pub/ca-server',
    'https://wt.ioa.pub/discovery'
)) {
    if ($config -notmatch [regex]::Escape($required)) {
        throw "配置缺少官方地址：$required"
    }
}
if ($config -match '(?i)(password|api[_-]?key|secret|token)\s*=\s*["''][^"'']+["'']') {
    throw "配置疑似包含明文凭据；请删除后再运行，登录凭据由 acps-cli 本地保存。"
}

Write-Host "acps-cli：$CliPath"
Write-Host "配置：$ConfigPath"
& $CliPath --config $ConfigPath --help | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "acps-cli 帮助命令失败，当前 CLI 可能不是兼容版本。"
}
& $CliPath --config $ConfigPath cert issue --help | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "当前 CLI 不支持 cert issue，不能继续申请证书。"
}
Write-Host "本地 CLI 和配置预检通过；尚未登录、获取 EAB 或签发证书。"
