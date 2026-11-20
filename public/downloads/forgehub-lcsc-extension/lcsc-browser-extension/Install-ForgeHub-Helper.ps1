$ErrorActionPreference = 'Stop'
$hostName = 'com.forgehub.lcsc_downloader'
$extensionId = 'nhjplifbkllandlklcfohleogoknkgld'
$sourceExe = Join-Path $PSScriptRoot 'native-host\lcsc-native-host.exe'
$installDir = Join-Path $env:LOCALAPPDATA 'ForgeHub\LcscDownloader'

if (-not (Test-Path -LiteralPath $sourceExe)) {
  throw 'Native helper was not found. Run this installer from the complete ForgeHub ZIP.'
}

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$installedExe = Join-Path $installDir 'lcsc-native-host.exe'
Copy-Item -LiteralPath $sourceExe -Destination $installedExe -Force

$nativeManifestPath = Join-Path $installDir ($hostName + '.json')
$nativeManifestData = [ordered]@{
  name = $hostName
  description = 'ForgeHub LCSC STEP download helper'
  path = $installedExe
  type = 'stdio'
  allowed_origins = @('chrome-extension://' + $extensionId + '/')
}
$nativeManifest = ConvertTo-Json -InputObject $nativeManifestData -Depth 4
$utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText($nativeManifestPath, $nativeManifest, $utf8NoBom)

$registryPaths = @(
  ('HKCU:\Software\Google\Chrome\NativeMessagingHosts\' + $hostName),
  ('HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\' + $hostName)
)
foreach ($registryPath in $registryPaths) {
  New-Item -Path $registryPath -Force | Out-Null
  Set-Item -Path $registryPath -Value $nativeManifestPath
}

Write-Host 'ForgeHub native STEP helper installed. Refresh the ForgeHub page.' -ForegroundColor Green
Write-Host ('Install location: ' + $installDir)
