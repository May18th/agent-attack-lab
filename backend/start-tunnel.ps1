param(
    [string]$BackendUrl = "http://127.0.0.1:8787"
)

$ErrorActionPreference = "Stop"
$Cloudflared = Join-Path $env:USERPROFILE "cloudflared.exe"
$NamedConfig = Join-Path $env:USERPROFILE ".cloudflared\agent-attack-lab.yml"
if (-not (Test-Path -LiteralPath $Cloudflared)) {
    throw "cloudflared.exe not found: $Cloudflared"
}

if ($env:CLOUDFLARE_TUNNEL_TOKEN) {
    Write-Host "Starting Cloudflare named tunnel."
    & $Cloudflared tunnel run --token $env:CLOUDFLARE_TUNNEL_TOKEN
} elseif (Test-Path -LiteralPath $NamedConfig) {
    Write-Host "Starting the persistent agent-attack-lab tunnel."
    & $Cloudflared tunnel --config $NamedConfig run
} else {
    Write-Host "CLOUDFLARE_TUNNEL_TOKEN is not set; starting a temporary Quick Tunnel."
    Write-Host "The public URL expires when this window is closed."
    & $Cloudflared tunnel --no-autoupdate --url $BackendUrl
}
