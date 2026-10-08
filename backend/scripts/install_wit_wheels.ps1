$ErrorActionPreference = "Stop"

$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
$python = Join-Path $backendRoot ".venv\Scripts\python.exe"
$packageDir = Join-Path $backendRoot "packages"

if (-not (Test-Path -LiteralPath $python)) {
    throw "未找到后端虚拟环境：$python"
}
if (-not (Test-Path -LiteralPath $packageDir)) {
    New-Item -ItemType Directory -Path $packageDir | Out-Null
}

$acpsWheel = Get-ChildItem -LiteralPath $packageDir -File -Filter "acps_sdk-2.2.0-*.whl" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$witWheel = Get-ChildItem -LiteralPath $packageDir -File -Filter "wit_framework-2.1.0-*.whl" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$manifest = Join-Path $packageDir "release-manifest.json"

if (-not $acpsWheel -or -not $witWheel -or -not (Test-Path -LiteralPath $manifest)) {
    Write-Host "缺少梧桐发行目录文件。请将以下三个相邻文件放入：$packageDir"
    Write-Host "  acps_sdk-2.2.0-py3-none-any.whl"
    Write-Host "  wit_framework-2.1.0-cp312.cp313.cp314-none-any.whl"
    Write-Host "  release-manifest.json"
    exit 2
}

$pythonVersion = & $python --version
Write-Host "使用解释器：$pythonVersion"
Write-Host "安装：$($acpsWheel.Name)"
Write-Host "安装：$($witWheel.Name)"

uv pip install --python $python $acpsWheel.FullName $witWheel.FullName

$preflight = Join-Path (Split-Path $python) "wit-release-preflight.exe"
if (-not (Test-Path -LiteralPath $preflight)) {
    throw "未找到发行预检命令：$preflight"
}
& $preflight --manifest $manifest
if ($LASTEXITCODE -ne 0) {
    throw "wit-release-preflight 未通过"
}

$check = @'
import importlib.metadata as metadata
import importlib.util

for package in ("acps-sdk", "wit-framework"):
    print(f"{package}={metadata.version(package)}")
for module in ("acps_sdk", "wit"):
    if importlib.util.find_spec(module) is None:
        raise SystemExit(f"缺少模块：{module}")
print("wit/acps 导入检查通过")
'@
$check | & $python -
if ($LASTEXITCODE -ne 0) {
    throw "wheel 已安装，但导入检查失败"
}

Write-Host "梧桐 wheel 安装和导入检查完成。"
