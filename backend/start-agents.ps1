param(
    [int]$AttackerPort = 8788,
    [int]$DefenderPort = 8789
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
$EnvLoader = Join-Path $ProjectRoot 'scripts\load-env.ps1'
if (Test-Path -LiteralPath $EnvLoader) { & $EnvLoader -ProjectRoot $ProjectRoot }
if (-not (Test-Path -LiteralPath $Python)) {
    throw 'Virtual environment not found. Run uv sync first.'
}
if ($AttackerPort -eq $DefenderPort) {
    throw 'Attacker and defender must use different ports.'
}

function Test-PortAvailable([int]$Port) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
        return $true
    }
    catch {
        throw "Port $Port is already in use. Choose another port or stop its owner."
    }
    finally {
        $listener.Stop()
    }
}

function Wait-AgentHealth([int]$Port, [string]$Name) {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 1
            if ($health.status -eq 'ok' -and $health.agent -eq $Name) { return }
        }
        catch {
            Start-Sleep -Milliseconds 300
        }
    }
    throw "$Name Agent did not become healthy on port $Port. Check its log under .data\agents."
}

$LogDirectory = Join-Path $ProjectRoot '.data\agents'
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$StartedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

try {
    Set-Location -LiteralPath $ProjectRoot
    foreach ($Agent in @(
        @{ Name = 'attacker'; Port = $AttackerPort; App = 'agent_attack_lab.agents.attacker:app' },
        @{ Name = 'defender'; Port = $DefenderPort; App = 'agent_attack_lab.agents.defender:app' }
    )) {
        $Healthy = $false
        try {
            $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$($Agent.Port)/health" -TimeoutSec 2
            $Healthy = $Health.status -eq 'ok' -and $Health.agent -eq $Agent.Name
        }
        catch { }
        if ($Healthy) {
            Write-Host "$($Agent.Name) Agent already running (mode: $($Health.agentMode))."
            continue
        }

        Test-PortAvailable $Agent.Port | Out-Null
        $process = Start-Process -FilePath $Python -ArgumentList @(
            '-m', 'uvicorn', $Agent.App,
            '--host', '127.0.0.1', '--port', "$($Agent.Port)", '--log-level', 'warning'
        ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $LogDirectory "$($Agent.Name).out.log") `
            -RedirectStandardError (Join-Path $LogDirectory "$($Agent.Name).err.log")
        $StartedProcesses.Add($process)
        Wait-AgentHealth $Agent.Port $Agent.Name
    }
}
catch {
    foreach ($process in $StartedProcesses) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    throw
}

Write-Host "Attacker Agent: http://127.0.0.1:$AttackerPort/rpc"
Write-Host "Defender Agent: http://127.0.0.1:$DefenderPort/rpc"
Write-Host 'Both agents are bound to loopback only.'
