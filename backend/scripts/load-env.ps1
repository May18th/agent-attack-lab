param([Parameter(Mandatory = $true)][string]$ProjectRoot)

# ASCII ONLY (PS 5.1 reads BOM-less files as ANSI; Chinese comments break parsing).
# Proxy env vars may exist in duplicated letter cases (inherited from Git Bash etc.).
# .NET Start-Process throws on case-insensitive duplicate keys when copying the
# environment dictionary, which kills start-agents.ps1 / restart.ps1. Outbound AIP
# clients use trust_env=False, so proxies are not needed; clear them all here.
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
