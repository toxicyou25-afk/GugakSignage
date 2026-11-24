# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param([switch]$Quiet)

$ErrorActionPreference = "Stop"
$installDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$configPath = Join-Path $installDir "install.json"
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "install.json을 찾지 못했습니다: $configPath"
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$logDir = [IO.Path]::GetFullPath([string]$config.logDir)
$statePath = Join-Path $logDir "watchdog-state.json"
$controlDir = Join-Path ([IO.Path]::GetFullPath([string]$config.dataDir)) "control"
New-Item -ItemType Directory -Path $controlDir -Force | Out-Null
Set-Content -LiteralPath (Join-Path $controlDir "stop.request") -Value ([DateTime]::UtcNow.ToString("o")) -Encoding ascii

function Get-OwnedProcess {
    param([int]$ProcessId, [string[]]$Needles)
    if ($ProcessId -le 0) { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    $commandLine = [string]$process.CommandLine
    foreach ($needle in $Needles) {
        if ($needle -and $commandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $process }
    }
    return $null
}

if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    while ([DateTime]::UtcNow -lt $deadline) {
        $watchdog = Get-OwnedProcess -ProcessId ([int]$state.watchdogPid) -Needles @("watchdog.mjs")
        if (-not $watchdog) { break }
        Start-Sleep -Milliseconds 250
    }
    foreach ($entry in @(
        @{ Id = $state.serverPid; Needles = @($installDir, "dist\server.js") },
        @{ Id = $state.browserPid; Needles = @([string]$config.profileDir) },
        @{ Id = $state.watchdogPid; Needles = @("watchdog.mjs") }
    )) {
        if ($entry.Id -and (Get-OwnedProcess -ProcessId ([int]$entry.Id) -Needles $entry.Needles)) {
            & taskkill.exe /PID ([int]$entry.Id) /T /F *> $null
        }
    }
}

Remove-Item -LiteralPath (Join-Path $controlDir "stop.request") -Force -ErrorAction SilentlyContinue
if (-not $Quiet) { Write-Host "[GugakSignage] 서버와 재생기를 중지했습니다." }
