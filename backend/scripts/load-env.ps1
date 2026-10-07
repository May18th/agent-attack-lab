param([Parameter(Mandatory = $true)][string]$ProjectRoot)

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
