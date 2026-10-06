param(
    [string]$BackendUrl = "http://127.0.0.1:8787"
)

$ErrorActionPreference = "Stop"
$Cloudflared = Join-Path $env:USERPROFILE "cloudflared.exe"
if (-not (Test-Path -LiteralPath $Cloudflared)) {
    throw "cloudflared.exe not found: $Cloudflared"
}

if ($env:CLOUDFLARE_TUNNEL_TOKEN) {
    Write-Host "Starting Cloudflare named tunnel."
    & $Cloudflared tunnel run --token $env:CLOUDFLARE_TUNNEL_TOKEN
} else {
    Write-Host "CLOUDFLARE_TUNNEL_TOKEN is not set; starting a temporary Quick Tunnel."
    Write-Host "The public URL expires when this window is closed."
    & $Cloudflared tunnel --no-autoupdate --url $BackendUrl
}
