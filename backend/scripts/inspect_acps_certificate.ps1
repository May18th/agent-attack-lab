param(
    [Parameter(Mandatory = $true)]
    [string]$CertificatePath,
    [string]$TrustBundlePath = "",
    [string]$KeyPath = ""
)

$ErrorActionPreference = "Stop"

foreach ($path in @($CertificatePath, $TrustBundlePath, $KeyPath)) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "文件不存在：$path"
    }
}

$certificate = Get-Item -LiteralPath $CertificatePath
if ($certificate.Length -lt 100) {
    throw "证书文件过小，可能不是有效 PEM：$CertificatePath"
}

$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if ($null -eq $openssl) {
    Write-Warning "本机未找到 openssl；仅完成文件存在性检查，未验证 SAN/EKU/证书链。"
    exit 0
}

Write-Host "证书摘要："
& $openssl.Source x509 -in $CertificatePath -noout -subject -issuer -dates -ext subjectAltName -ext extendedKeyUsage
if ($LASTEXITCODE -ne 0) {
    throw "openssl 无法解析证书：$CertificatePath"
}
if (-not [string]::IsNullOrWhiteSpace($TrustBundlePath)) {
    & $openssl.Source verify -CAfile $TrustBundlePath $CertificatePath
    if ($LASTEXITCODE -ne 0) {
        throw "证书链校验失败。"
    }
}
if (-not [string]::IsNullOrWhiteSpace($KeyPath)) {
    $certPublic = (& $openssl.Source x509 -in $CertificatePath -pubkey -noout | Out-String).Trim()
    $keyPublic = (& $openssl.Source pkey -in $KeyPath -pubout | Out-String).Trim()
    if ($certPublic -ne $keyPublic) {
        throw "私钥与证书公钥不匹配。"
    }
}
Write-Host "证书文件检查通过。"
