param(
    [string]$ConfigPath = "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml",
    [string]$ApiUrl = "https://api.yuanyiagentzhandui.cn/health"
)

$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell window."
}
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "cloudflared config was not found: $ConfigPath"
}

$raw = [IO.File]::ReadAllText($ConfigPath)
if ($raw -notmatch '(?m)^\s*- hostname:\s*api\.yuanyiagentzhandui\.cn\s*$') {
    $userConfig = Join-Path $env:USERPROFILE ".cloudflared\yuanyi-agent-attack-lab.yml"
    if (-not (Test-Path -LiteralPath $userConfig -PathType Leaf)) {
        throw "The API hostname was not found in the service config or the user tunnel config. No changes were made."
    }
    $userRaw = [IO.File]::ReadAllText($userConfig)
    if ($userRaw -notmatch '(?m)^\s*- hostname:\s*api\.yuanyiagentzhandui\.cn\s*$') {
        throw "The API hostname was not found in the service config or the user tunnel config. No changes were made."
    }
    $backup = "$ConfigPath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Copy-Item -LiteralPath $ConfigPath -Destination $backup -Force
    $raw = $userRaw
    Write-Host "Restored the service config source from: $userConfig"
    Write-Host "Backed up the previous service config to: $backup"
}
if ($raw -notmatch '(?m)^\s+path:\s*\^/rpc\$\s*$') {
    Write-Host "No RPC-only path rule found. No config change is needed."
} else {
    $backup = "$ConfigPath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Copy-Item -LiteralPath $ConfigPath -Destination $backup -Force
    $updated = [regex]::Replace($raw, '(?m)^\s+path:\s*\^/rpc\$\s*\r?\n', '')
    [IO.File]::WriteAllText($ConfigPath, $updated, [Text.UTF8Encoding]::new($false))
    Write-Host "Backed up the previous config to: $backup"
    Write-Host "Removed the /rpc-only path rule. The API hostname now forwards all backend routes."
}

Restart-Service -Name cloudflared -Force
Start-Sleep -Seconds 3
$service = Get-Service -Name cloudflared
if ($service.Status -ne "Running") {
    throw "cloudflared service did not return to Running: $($service.Status)"
}

try {
    $local = Invoke-WebRequest -Uri "http://127.0.0.1:8787/health" -TimeoutSec 10
    Write-Host "Local /health: $($local.StatusCode)"
} catch {
    throw "Local port 8787 /health is unavailable; public verification was stopped: $($_.Exception.Message)"
}

try {
    $public = Invoke-WebRequest -Uri $ApiUrl -TimeoutSec 20
    Write-Host "Public /health: $($public.StatusCode)"
    Write-Host $public.Content
} catch {
    throw "Public API is still unavailable: $($_.Exception.Message). Check the Cloudflare public hostname and tunnel binding."
}

Write-Host "Cloudflare API route repair and verification completed."
