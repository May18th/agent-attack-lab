# 为当前 PowerShell 进程设置 AMP 心跳相关变量（start / restart / start-agents 共用）。
# AMP 心跳决定梧桐 Discovery 里能否按"在线"检索到本智能体：不上报心跳的 Agent
# 存活状态是 unknown，平台的默认查询（含首页「输入 AIC 查询在线状态」）不会返回它。
param(
    [Parameter(Mandatory = $true)][ValidateSet('leader', 'attacker', 'defender')][string]$Role
)

$BackendRoot = Split-Path -Parent $PSScriptRoot
$IdentitiesFile = Join-Path $BackendRoot 'agent-identities.json'

# 显式设置 AGENT_AMP_ENABLED=0 时尊重该选择（比如离线演示、无外网环境）。
$AmpEnabled = $true
if ($env:AGENT_AMP_ENABLED -eq '0') { $AmpEnabled = $false }

$env:AGENT_AMP_ROLE = $Role
$env:AGENT_AMP_IDENTITIES_FILE = $IdentitiesFile
$env:AGENT_AMP_ENABLED = if ($AmpEnabled) { '1' } else { '0' }

if ([string]::IsNullOrWhiteSpace($env:AGENT_AMP_KAFKA_BROKERS)) {
    $env:AGENT_AMP_KAFKA_BROKERS = 'wt.ioa.pub:19092'
}
if ([string]::IsNullOrWhiteSpace($env:AGENT_AMP_LOG_DIR)) {
    $env:AGENT_AMP_LOG_DIR = Join-Path $BackendRoot '.data\amp'
}

if ($AmpEnabled) {
    Write-Host "AMP heartbeat: role=$Role (enable=1, brokers=$($env:AGENT_AMP_KAFKA_BROKERS))"
} else {
    Write-Host "AMP heartbeat: role=$Role (disabled by AGENT_AMP_ENABLED=0)"
}
