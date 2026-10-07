param()

$ErrorActionPreference = "Stop"
$Cloudflared = Join-Path $env:USERPROFILE "cloudflared.exe"
$Config = Join-Path $env:USERPROFILE ".cloudflared\agent-attack-lab-agents.yml"

if (-not (Test-Path -LiteralPath $Cloudflared)) {
    throw "cloudflared.exe not found: $Cloudflared"
}
if (-not (Test-Path -LiteralPath $Config)) {
    throw "agents tunnel config not found: $Config"
}

# 已在线则不重复启动（重复连接器无害但多余）
try {
    $health = Invoke-RestMethod -Uri "https://attacker.kechuang2026.cn/health" -TimeoutSec 5 -ErrorAction Stop
    if ($health.status -eq "ok") {
        Write-Host "agents tunnel already online: attacker.kechuang2026.cn health ok"
        return
    }
} catch {
    Write-Host "agents tunnel not reachable yet, starting connector..."
}

Write-Host "Starting agent-attack-lab-agents tunnel (attacker/defender.kechuang2026.cn)."
Start-Process -FilePath $Cloudflared -ArgumentList @("tunnel", "--config", $Config, "run") -WindowStyle Minimized
Start-Sleep -Seconds 6

try {
    $health = Invoke-RestMethod -Uri "https://attacker.kechuang2026.cn/health" -TimeoutSec 8 -ErrorAction Stop
    Write-Host ("agents tunnel online, agentMode=" + $health.agentMode)
} catch {
    Write-Warning "tunnel connector started but health check failed (system proxy may interfere)."
    Write-Warning "Verify manually: curl --noproxy '*' https://attacker.kechuang2026.cn/health"
}
