# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param([switch]$Quiet)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "install-common.ps1")
$installDir = Get-NormalizedPath -Path (Join-Path $PSScriptRoot "..")
$configPath = Join-Path $installDir "install.json"
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "install.json을 찾지 못했습니다: $configPath"
}
$config = Read-JsonFile -Path $configPath
$logDir = Get-NormalizedPath -Path ([string]$config.logDir)
$statePath = Join-Path $logDir "watchdog-state.json"
$controlDir = Join-Path (Get-NormalizedPath -Path ([string]$config.dataDir)) "control"
$stopRequest = Join-Path $controlDir "stop.request"
New-Item -ItemType Directory -Path $controlDir -Force | Out-Null
Set-Content -LiteralPath $stopRequest -Value ([DateTime]::UtcNow.ToString("o")) -Encoding ascii

if (Test-Path -LiteralPath $statePath) {
    $state = Read-JsonFile -Path $statePath
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $deadline) {
        $watchdog = Get-VerifiedOwnedProcess -ProcessId ([int]$state.watchdogPid) -ExpectedExecutable ([string]$config.nodePath) -ExpectedStartTime ([string]$state.watchdogStartedAt) -CommandLineContains @($installDir, "watchdog.mjs") -InstallDir $installDir
        if (-not $watchdog) { break }
        Start-Sleep -Milliseconds 250
    }

    $stoppedServer = Stop-VerifiedOwnedProcess -ProcessId ([int]$state.serverPid) -ExpectedExecutable ([string]$config.nodePath) -ExpectedStartTime ([string]$state.serverStartedAt) -CommandLineContains @($installDir, "dist\server.js") -InstallDir $installDir
    $stoppedBrowser = Stop-VerifiedOwnedProcess -ProcessId ([int]$state.browserPid) -ExpectedExecutable ([string]$config.browserPath) -ExpectedStartTime ([string]$state.browserStartedAt) -CommandLineContains @([string]$config.profileDir) -InstallDir $installDir
    $stoppedWatchdog = Stop-VerifiedOwnedProcess -ProcessId ([int]$state.watchdogPid) -ExpectedExecutable ([string]$config.nodePath) -ExpectedStartTime ([string]$state.watchdogStartedAt) -CommandLineContains @($installDir, "watchdog.mjs") -InstallDir $installDir
}

Remove-Item -LiteralPath $stopRequest -Force -ErrorAction SilentlyContinue
if (-not $Quiet) { Write-Host "[GugakSignage] 서버와 재생기를 중지했습니다." }
