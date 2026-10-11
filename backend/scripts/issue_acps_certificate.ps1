param(
    [Parameter(Mandatory = $true)]
    [string]$Aic,
    [ValidateSet("clientAuth", "serverAuth")]
    [string]$Usage = "clientAuth",
    [ValidateSet("ed25519", "rsa", "ec")]
    [string]$KeyType = "ed25519",
    [string]$CliPath = "",
    [string]$ConfigPath = "",
    [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"

$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($CliPath)) {
    $CliPath = Join-Path $backendRoot "..\tools\ACPs-community\acps-cli\.venv\Scripts\acps-cli.exe"
}
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $backendRoot "acps-cli.toml"
}
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $backendRoot ".acps-cli\certs\$($Aic.Replace('.', '_'))\$Usage"
}

if (-not (Test-Path -LiteralPath $CliPath -PathType Leaf)) {
    throw "未找到 acps-cli：$CliPath"
}
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "未找到配置：$ConfigPath。请先复制 backend/acps-cli.toml.example。"
}
if ($Aic -match '[^A-Za-z0-9._-]') {
    throw "AIC 含有不允许用于本地路径的字符。"
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$eabPath = Join-Path $OutputRoot "eab.json"
$keyPath = Join-Path $OutputRoot "agent-key.pem"
$certPath = Join-Path $OutputRoot "agent-cert.pem"
$trustPath = Join-Path $OutputRoot "trust-bundle.pem"

Write-Host "即将为 AIC $Aic 申请 $Usage 证书。"
Write-Host "凭据由 acps-cli 交互式读取；不会写入仓库或命令行参数。"
Write-Host "第一步：获取 EAB"
& $CliPath --config $ConfigPath cert eab fetch --aic $Aic --output $eabPath --json
if ($LASTEXITCODE -ne 0) {
    throw "EAB 获取失败；请确认已登录、AIC 已审核通过且 CLI 地址正确。"
}

Write-Host "第二步：签发 $Usage mTLS 证书"
& $CliPath --config $ConfigPath cert issue `
    --aic $Aic `
    --eab-file $eabPath `
    --usage $Usage `
    --key-type $KeyType `
    --key-path $keyPath `
    --cert-path $certPath `
    --trust-bundle-path $trustPath
if ($LASTEXITCODE -ne 0) {
    throw "证书签发失败。EAB 保留在本机目录，排障后可删除。"
}

foreach ($path in @($eabPath, $keyPath, $certPath, $trustPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "CLI 返回成功，但缺少预期文件：$path"
    }
}

Write-Host "证书材料已写入：$OutputRoot"
Write-Host "请勿将该目录、EAB、私钥或证书提交 GitHub。"
