<#
.SYNOPSIS
    从梧桐官方发行目录获取绑定的 SDK/wit wheel，并按 release-manifest 校验。
.DESCRIPTION
    只访问 wit.ioa.pub，不使用 PyPI、GitHub 或第三方镜像。发行目录通常需要
    登录梧桐网络/零信任后才能访问。下载完成后应继续运行 install_wit_wheels.ps1。
#>
param(
    [string]$ReleaseBase = "",
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $backendRoot "packages"
}

$candidateBases = @(
    "https://wit.ioa.pub/release",
    "https://wit.ioa.pub/download",
    "https://wit.ioa.pub/static/release",
    "https://wit.ioa.pub/dist",
    "https://wit.ioa.pub/simple"
)
if (-not [string]::IsNullOrWhiteSpace($ReleaseBase)) {
    $candidateBases = @($ReleaseBase) + $candidateBases
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$manifestPath = Join-Path $OutDir "release-manifest.json"

function Download-OfficialFile([string]$Url, [string]$Destination) {
    try {
        & curl.exe -kL --fail --max-time 90 -o $Destination $Url
        return ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $Destination) -and ((Get-Item $Destination).Length -gt 0))
    } catch {
        return $false
    }
}

$resolvedBase = $null
foreach ($base in $candidateBases) {
    $manifestUrl = "$base/release-manifest.json"
    Write-Host "尝试官方清单：$manifestUrl"
    if (Download-OfficialFile $manifestUrl $manifestPath) {
        $resolvedBase = $base.TrimEnd('/')
        break
    }
}
if ($null -eq $resolvedBase) {
    throw "无法访问梧桐官方 release-manifest.json。请先登录梧桐网络/零信任，或用 -ReleaseBase 指定手册中的发行目录。"
}

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
Write-Host "已获取官方清单：$manifestPath"
Write-Host (Get-Content -Raw -LiteralPath $manifestPath)

function Get-ChildProperties($Node) {
    if ($Node -is [System.Collections.IDictionary]) {
        return $Node.GetEnumerator() | ForEach-Object { [pscustomobject]@{ Name = [string]$_.Key; Value = $_.Value } }
    }
    if ($Node -is [pscustomobject]) {
        return $Node.PSObject.Properties | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Value = $_.Value } }
    }
    return @()
}

function Find-WheelMetadata($Node, [string]$FileName) {
    if ($null -eq $Node) { return $null }
    $properties = @(Get-ChildProperties $Node)
    if ($properties.Count -gt 0) {
        $strings = @($properties | Where-Object { $_.Value -is [string] })
        $hasFile = $strings | Where-Object { $_.Value -like "*$FileName*" }
        if ($hasFile) {
            $urlProperty = $strings | Where-Object { $_.Name -match '(?i)url|uri|download|link|path' -and $_.Value -match '(?i)\.whl($|[?#])|^https?://' } | Select-Object -First 1
            $hashProperty = $strings | Where-Object { $_.Name -match '(?i)sha|hash|digest|sum' -and $_.Value -match '^[0-9a-fA-F]{64}$' } | Select-Object -First 1
            if ($urlProperty -or $hashProperty) {
                return [pscustomobject]@{ Url = if ($urlProperty) { $urlProperty.Value } else { $null }; Sha256 = if ($hashProperty) { $hashProperty.Value } else { $null } }
            }
        }
        foreach ($property in $properties) {
            $found = Find-WheelMetadata $property.Value $FileName
            if ($found) { return $found }
        }
        return $null
    }
    if ($Node -is [System.Collections.IEnumerable] -and $Node -isnot [string]) {
        foreach ($item in $Node) {
            $found = Find-WheelMetadata $item $FileName
            if ($found) { return $found }
        }
    }
    return $null
}

$targets = @(
    "acps_sdk-2.2.0-py3-none-any.whl",
    "wit_framework-2.1.0-cp312.cp313.cp314-none-any.whl"
)
foreach ($fileName in $targets) {
    $metadata = Find-WheelMetadata $manifest $fileName
    $url = if ($metadata -and $metadata.Url) { [string]$metadata.Url } else { "$resolvedBase/$fileName" }
    if ($url -notmatch '^https?://') { $url = "$resolvedBase/$($url.TrimStart('./'))" }
    $destination = Join-Path $OutDir $fileName
    Write-Host "下载：$url"
    if (-not (Download-OfficialFile $url $destination)) {
        throw "官方 wheel 下载失败：$url"
    }
    if (-not $metadata -or [string]::IsNullOrWhiteSpace([string]$metadata.Sha256)) {
        throw "清单未提供 $fileName 的 SHA-256，拒绝继续。"
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
    $expected = ([string]$metadata.Sha256).ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "SHA-256 校验失败：$fileName（期望 $expected，实际 $actual）"
    }
    Write-Host "SHA-256 校验通过：$fileName"
}

Write-Host "官方发行文件已准备到：$OutDir"
Write-Host "下一步运行：.\scripts\install_wit_wheels.ps1"
