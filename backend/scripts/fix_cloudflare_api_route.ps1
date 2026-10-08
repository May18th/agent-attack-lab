param(
    [string]$ConfigPath = "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml",
    [string]$ApiUrl = "https://api.yuanyiagentzhandui.cn/health"
)

$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "请以管理员身份运行 PowerShell 后再执行此脚本。"
}
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "找不到 cloudflared 配置：$ConfigPath"
}

$raw = [IO.File]::ReadAllText($ConfigPath)
if ($raw -notmatch '(?m)^\s*- hostname:\s*api\.yuanyiagentzhandui\.cn\s*$') {
    throw "配置中未找到 api.yuanyiagentzhandui.cn，已停止，未改动文件。"
}
if ($raw -notmatch '(?m)^\s+path:\s*\^/rpc\$\s*$') {
    Write-Host "未发现仅限 /rpc 的路径规则，配置无需修改。"
} else {
    $backup = "$ConfigPath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Copy-Item -LiteralPath $ConfigPath -Destination $backup -Force
    $updated = [regex]::Replace($raw, '(?m)^\s+path:\s*\^/rpc\$\s*\r?\n', '')
    [IO.File]::WriteAllText($ConfigPath, $updated, [Text.UTF8Encoding]::new($false))
    Write-Host "已备份旧配置：$backup"
    Write-Host "已移除 /rpc 路径限制，api hostname 现在转发全部后端路由。"
}

Restart-Service -Name cloudflared -Force
Start-Sleep -Seconds 3
$service = Get-Service -Name cloudflared
if ($service.Status -ne "Running") {
    throw "cloudflared 服务未恢复运行：$($service.Status)"
}

try {
    $local = Invoke-WebRequest -Uri "http://127.0.0.1:8787/health" -TimeoutSec 10
    Write-Host "本机 /health：$($local.StatusCode)"
} catch {
    throw "本机 8787 /health 不可用，已停止公网验收：$($_.Exception.Message)"
}

try {
    $public = Invoke-WebRequest -Uri $ApiUrl -TimeoutSec 20
    Write-Host "公网 /health：$($public.StatusCode)"
    Write-Host $public.Content
} catch {
    throw "公网 API 仍不可用：$($_.Exception.Message)。请检查 Cloudflare public hostname 是否绑定同一 Tunnel。"
}

Write-Host "Cloudflare API 路由修复并验收完成。"
