param([Parameter(Mandatory = $true)][string]$ProjectRoot)

# 代理环境变量可能同时存在大小写两份（例如从 Git Bash / 某些终端继承），
# .NET Start-Process 复制环境字典时会对大小写不敏感的重复键抛
# “已添加项。字典中的关键字”异常，导致 start-agents.ps1 / restart.ps1 直接失败。
# 本服务出站 AIP 客户端已显式 trust_env=False，不依赖代理变量，这里统一清除。
foreach ($ProxyName in @('HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy')) {
    if ([Environment]::GetEnvironmentVariable($ProxyName, 'Process')) {
        Remove-Item ("Env:" + $ProxyName) -ErrorAction SilentlyContinue
    }
}

$EnvPath = Join-Path $ProjectRoot '.env'
if (-not (Test-Path -LiteralPath $EnvPath)) { return }

foreach ($Line in [System.IO.File]::ReadAllLines($EnvPath)) {
    $Trimmed = $Line.Trim()
    if (-not $Trimmed -or $Trimmed.StartsWith('#')) { continue }
    $Parts = $Trimmed -split '=', 2
    if ($Parts.Count -ne 2) { continue }
    $Name = $Parts[0].Trim()
    $Value = $Parts[1].Trim()
    if ($Value.Length -ge 2 -and (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or ($Value.StartsWith("'") -and $Value.EndsWith("'")))) {
        $Value = $Value.Substring(1, $Value.Length - 2)
    }
    if ($Name -match '^AGENT_[A-Z0-9_]+$' -and [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name, 'Process'))) {
        [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
    }
}
