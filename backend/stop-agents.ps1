param(
    [int]$AttackerPort = 8788,
    [int]$DefenderPort = 8789
)

$ErrorActionPreference = 'Stop'

$targets = @(
    @{ Agent = 'agent_attack_lab.agents.attacker:app'; Port = $AttackerPort },
    @{ Agent = 'agent_attack_lab.agents.defender:app'; Port = $DefenderPort }
)
$processes = Get-CimInstance Win32_Process | Where-Object {
    $commandLine = $_.CommandLine
    $commandLine -and $commandLine.Contains('-m uvicorn') -and
    ($targets | Where-Object {
        $commandLine.Contains($_.Agent) -and
        ($commandLine.Contains("--port $($_.Port)") -or $commandLine.Contains("--port=$($_.Port)"))
    }).Count -gt 0
}

foreach ($process in $processes) {
    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
}

Write-Host "Stopped $($processes.Count) standalone Agent process(es)."
