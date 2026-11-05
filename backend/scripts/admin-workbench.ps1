param(
    [ValidateSet('Run', 'Stop')]
    [string]$Mode = 'Run'
)

$ErrorActionPreference = 'Stop'
$BackendRoot = Split-Path -Parent $PSScriptRoot
$ProjectRoot = Split-Path -Parent $BackendRoot
$FrontendRoot = Join-Path $ProjectRoot 'frontend\frontend-ui'
$Python = Join-Path $BackendRoot '.venv\Scripts\python.exe'
$StateRoot = Join-Path $env:LOCALAPPDATA 'WutongAdmin'
$LogRoot = Join-Path $StateRoot 'logs'
$StopSignal = Join-Path $StateRoot 'stop.request'
$TaskName = 'Wutong Admin 3D Workbench'

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

function Write-Log([string]$Message) {
    $line = "{0:u} {1}" -f (Get-Date), $Message
    Add-Content -LiteralPath (Join-Path $LogRoot 'watchdog.log') -Value $line -Encoding UTF8
}

function Test-Endpoint([string]$Uri) {
    try {
        $response = Invoke-WebRequest -Uri $Uri -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    }
    catch { return $false }
}

function Test-LoopbackPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($pending)
        return $true
    }
    catch { return $false }
    finally { $client.Dispose() }
}

if ($Mode -eq 'Stop') {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task -or $task.State -eq 'Ready') {
        Remove-Item -LiteralPath $StopSignal -Force -ErrorAction SilentlyContinue
        Write-Log 'Stop requested while watchdog was not running.'
        exit 0
    }

    Set-Content -LiteralPath $StopSignal -Value 'stop' -Encoding ASCII
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Seconds 1
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if (-not $task -or $task.State -eq 'Ready') { exit 0 }
    }
    throw 'Timed out waiting for the workbench watchdog to stop.'
}

Remove-Item -LiteralPath $StopSignal -Force -ErrorAction SilentlyContinue
if (-not (Test-Path -LiteralPath $Python)) { throw "Python environment not found: $Python" }
if (-not (Test-Path -LiteralPath (Join-Path $FrontendRoot 'node_modules\vite\bin\vite.js'))) {
    throw "Vite installation not found under $FrontendRoot."
}

$ownedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$envLoaded = $false

function Start-ManagedProcess([string]$Name, [string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $LogRoot "$Name.out.log") `
        -RedirectStandardError (Join-Path $LogRoot "$Name.err.log")
    $ownedProcesses.Add($process)
    Write-Log "Started $Name (pid $($process.Id))."
}

function Ensure-Api {
    if (Test-Endpoint 'http://127.0.0.1:8787/health') { return }
    if (Test-LoopbackPort 8787) { Write-Log 'API port 8787 is occupied but health check failed; leaving its owner untouched.'; return }

    if (-not $script:envLoaded) {
        $loader = Join-Path $BackendRoot 'scripts\load-env.ps1'
        if (Test-Path -LiteralPath $loader) { & $loader -ProjectRoot $BackendRoot }
        if ([string]::IsNullOrWhiteSpace($env:AGENT_ATTACKER_RPC_URL)) { $env:AGENT_ATTACKER_RPC_URL = 'http://127.0.0.1:8788/rpc' }
        if ([string]::IsNullOrWhiteSpace($env:AGENT_DEFENDER_RPC_URL)) { $env:AGENT_DEFENDER_RPC_URL = 'http://127.0.0.1:8789/rpc' }
        $script:envLoaded = $true
        try { & (Join-Path $BackendRoot 'start-agents.ps1') *> (Join-Path $LogRoot 'agents-start.log') }
        catch { Write-Log "Agent startup did not complete: $($_.Exception.Message)" }
    }

    Start-ManagedProcess 'api' $Python @('-m', 'uvicorn', 'agent_attack_lab.service:app', '--host', '127.0.0.1', '--port', '8787', '--log-level', 'info', '--no-access-log') $BackendRoot
}

function Ensure-Frontend {
    if (Test-Endpoint 'http://127.0.0.1:5173/admin') { return }
    if (Test-LoopbackPort 5173) { Write-Log 'Frontend port 5173 is occupied but the admin page check failed; leaving its owner untouched.'; return }

    $node = (Get-Command node.exe -ErrorAction Stop).Source
    Start-ManagedProcess 'frontend' $node @((Join-Path $FrontendRoot 'node_modules\vite\bin\vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort') $FrontendRoot
}

Write-Log 'Admin workbench watchdog started.'
try {
    while (-not (Test-Path -LiteralPath $StopSignal)) {
        Ensure-Api
        Ensure-Frontend
        Start-Sleep -Seconds 10
    }
}
finally {
    foreach ($process in $ownedProcesses) {
        try {
            $process.Refresh()
            if (-not $process.HasExited) {
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
                Write-Log "Stopped owned process $($process.Id)."
            }
        }
        catch { }
    }
    Remove-Item -LiteralPath $StopSignal -Force -ErrorAction SilentlyContinue
    Write-Log 'Admin workbench watchdog stopped.'
}
