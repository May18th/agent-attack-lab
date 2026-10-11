$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")
uv run pytest -q tests/test_isolated_contract.py
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
