param(
    [switch]$AllowHttp,
    [switch]$RequireIdentityBinding
)

$ErrorActionPreference = "Stop"

function Require-Env([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "缺少环境变量：$Name"
    }
    return $value.Trim()
}

function Require-File([string]$Name) {
    $path = Require-Env $Name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "$Name 指向的文件不存在：$path"
    }
    return $path
}

function Validate-Endpoint([string]$Name) {
    $raw = Require-Env $Name
    $uri = $null
    if (-not [Uri]::TryCreate($raw, [UriKind]::Absolute, [ref]$uri)) {
        throw "$Name 不是有效的绝对 URL"
    }
    if ($uri.AbsolutePath -notmatch '/rpc/?$') {
        throw "$Name 必须指向 /rpc endpoint：$raw"
    }
    if (-not $AllowHttp -and $uri.Scheme -ne "https") {
        throw "$Name 生产配置必须使用 HTTPS；本地测试请加 -AllowHttp"
    }
    return $uri
}

$leaderId = Require-Env "AGENT_AIP_LEADER_ID"
if ($leaderId -match '(?i)(example|placeholder|真实|平台分配|<|>)') {
    throw "AGENT_AIP_LEADER_ID 仍是占位值，不能用于生产 mTLS"
}

$attacker = Validate-Endpoint "AGENT_ATTACKER_RPC_URL"
$defender = Validate-Endpoint "AGENT_DEFENDER_RPC_URL"
$cert = Require-File "AGENT_AIP_MTLS_CERT_FILE"
$key = Require-File "AGENT_AIP_MTLS_KEY_FILE"
$ca = Require-File "AGENT_AIP_CA_FILE"

$identityEnabled = [Environment]::GetEnvironmentVariable("AGENT_IDENTITY_BINDING_ENABLED", "Process")
if ($RequireIdentityBinding -or $identityEnabled -match '^(1|true|yes|on)$') {
    $localAic = Require-Env "AGENT_LOCAL_AIC"
    if ($localAic -match '(?i)(example|placeholder|真实|平台分配|<|>)') {
        throw "AGENT_LOCAL_AIC 仍是占位值，不能用于生产 mTLS"
    }
}

Write-Host "ACP mTLS 环境变量和文件路径通过预检。"
Write-Host "Leader AIC 已配置（值不输出）。"
Write-Host "Attacker endpoint：$($attacker.AbsoluteUri)"
Write-Host "Defender endpoint：$($defender.AbsoluteUri)"
Write-Host "证书、私钥和 trust bundle 文件均存在（内容不输出）。"
Write-Host "下一步：运行 inspect_acps_certificate.ps1 分别核对 SAN、EKU、公钥匹配和证书链。"
