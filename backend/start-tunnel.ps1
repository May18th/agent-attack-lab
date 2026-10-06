param(
    [string]$BackendUrl = "http://127.0.0.1:8787"
)

$ErrorActionPreference = "Stop"
$Cloudflared = Join-Path $env:USERPROFILE "cloudflared.exe"
if (-not (Test-Path -LiteralPath $Cloudflared)) {
    throw "找不到 cloudflared.exe：$Cloudflared"
}

if ($env:CLOUDFLARE_TUNNEL_TOKEN) {
    Write-Host "正在启动 Cloudflare 命名隧道（稳定地址由 Cloudflare 控制台分配）"
    & $Cloudflared tunnel run --token $env:CLOUDFLARE_TUNNEL_TOKEN
} else {
    Write-Host "未设置 CLOUDFLARE_TUNNEL_TOKEN，启动临时 Quick Tunnel"
    Write-Host "关闭窗口后公网地址会失效。"
    & $Cloudflared tunnel --no-autoupdate --url $BackendUrl
}
