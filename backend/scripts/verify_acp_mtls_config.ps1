param(
    [switch]$AllowHttp,
    [switch]$RequireIdentityBinding,
    [switch]$RequireLeaderIdentityBinding,
    [switch]$RequirePartnerIdentityBinding
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

function Test-Enabled([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    return $value -match '^(?i:1|true|yes|on)$'
}

function Find-ProjectPython {
    $backendRoot = Split-Path -Parent $PSScriptRoot
    $candidates = @(
        (Join-Path $backendRoot ".venv\Scripts\python.exe"),
        (Join-Path $backendRoot ".venv/bin/python")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        return $python.Source
    }
    throw "找不到项目 Python，无法核对 acps-sdk 身份绑定能力"
}

function Assert-SdkIdentityBindingSupport {
    $python = Find-ProjectPython
    $probe = @'
import inspect
from acps_sdk.aip.aip_rpc_server import handle_rpc_request
p = inspect.signature(handle_rpc_request).parameters
supported = any(v.kind is inspect.Parameter.VAR_KEYWORD for v in p.values()) or {"local_aic", "identity_binding_enabled"}.issubset(p)
print("SUPPORTED" if supported else "UNSUPPORTED")
'@
    $result = (& $python -c $probe 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "无法检查 acps-sdk 身份绑定能力：$result"
    }
    if ($result -ne "SUPPORTED") {
        throw "身份绑定已开启，但当前 acps-sdk 不支持服务端身份绑定参数；不能把配置视为已经生效"
    }
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

$leaderIdentityEnabled = Test-Enabled "AGENT_IDENTITY_BINDING_ENABLED"
$partnerIdentityEnabled = Test-Enabled "AGENT_PARTNER_IDENTITY_BINDING_ENABLED"
$leaderRequired = $RequireIdentityBinding -or $RequireLeaderIdentityBinding

if ($leaderRequired -and -not $leaderIdentityEnabled) {
    throw "要求 Leader 身份绑定，但 AGENT_IDENTITY_BINDING_ENABLED 未开启"
}
if ($RequirePartnerIdentityBinding -and -not $partnerIdentityEnabled) {
    throw "要求 Partner 身份绑定，但 AGENT_PARTNER_IDENTITY_BINDING_ENABLED 未开启"
}

if ($leaderIdentityEnabled -or $partnerIdentityEnabled) {
    $localAic = Require-Env "AGENT_LOCAL_AIC"
    if ($localAic -match '(?i)(example|placeholder|真实|平台分配|<|>)') {
        throw "AGENT_LOCAL_AIC 仍是占位值，不能用于生产 mTLS"
    }
    Assert-SdkIdentityBindingSupport
}

Write-Host "ACP mTLS 环境变量和文件路径通过预检。"
Write-Host "Leader AIC 已配置（值不输出）。"
Write-Host "Attacker endpoint：$($attacker.AbsoluteUri)"
Write-Host "Defender endpoint：$($defender.AbsoluteUri)"
Write-Host "证书、私钥和 trust bundle 文件均存在（内容不输出）。"
Write-Host "Leader 服务端身份绑定配置：$(if ($leaderIdentityEnabled) { '已开启且 SDK 支持' } else { '未开启' })"
Write-Host "Partner 服务端身份绑定配置：$(if ($partnerIdentityEnabled) { '已开启且 SDK 支持' } else { '未开启' })"
Write-Host "注意：预检通过只代表本机配置与 SDK 能力齐全，不代表真实 mTLS 通道已经验收。"
Write-Host "下一步：运行 inspect_acps_certificate.ps1 核对 SAN、EKU、公钥匹配和证书链，再进行真实公网端到端测试。"
