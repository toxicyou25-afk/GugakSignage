# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [switch]$Enable,
    [switch]$Disable,
    [switch]$Restart,
    [switch]$Status,
    [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"
$commonPath = Join-Path $PSScriptRoot "ops\install-common.ps1"
if (-not (Test-Path -LiteralPath $commonPath)) { $commonPath = Join-Path $PSScriptRoot "..\ops\install-common.ps1" }
. $commonPath
$installDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$configPath = Join-Path $installDir "install.json"
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "install.json을 찾지 못했습니다: $configPath"
}
$config = Read-JsonFile -Path $configPath
$taskName = [string]$config.taskName
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if (@($Enable, $Disable, $Restart | Where-Object { $_ }).Count -gt 1) {
    throw "-Enable, -Disable, -Restart 중 하나만 사용할 수 있습니다."
}
if (-not $Enable -and -not $Disable -and -not $Restart) { $Status = $true }

if ($Status) {
    if (-not $task) {
        Write-Host "자동 실행 작업 '$taskName'이(가) 없습니다."
        exit 1
    }
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    Write-Host "작업 이름: $taskName"
    Write-Host "상태: $($task.State)"
    Write-Host "마지막 실행: $($info.LastRunTime)"
    Write-Host "마지막 결과: $($info.LastTaskResult)"
    $statePath = Join-Path ([string]$config.logDir) "watchdog-state.json"
    if (Test-Path -LiteralPath $statePath) {
        $state = Read-JsonFile -Path $statePath
        Write-Host "Watchdog PID: $($state.watchdogPid)"
        Write-Host "중단 여부: $($state.halted)"
        if ($state.haltedReason) { Write-Host "중단 사유: $($state.haltedReason)" }
    }
    exit 0
}

if ($Disable) {
    if ($task) {
        if (-not (Test-ScheduledTaskOwnedByInstall -Task $task -InstallDir $installDir)) {
            throw "같은 이름의 다른 자동 실행 작업이므로 변경하지 않았습니다: $taskName"
        }
        Disable-ScheduledTask -TaskName $taskName | Out-Null
    }
    if (-not $KeepRunning) {
        & (Join-Path $installDir "ops\stop.ps1") -Quiet
    }
    Write-Host "[GugakSignage] 다음 로그인부터 자동 실행하지 않습니다."
    exit 0
}

if ($Enable) {
    if (-not $task) {
        throw "자동 실행 작업이 없습니다. installer\install.ps1 -ConfigureOnly로 다시 등록하세요."
    }
    if (-not (Test-ScheduledTaskOwnedByInstall -Task $task -InstallDir $installDir)) {
        throw "같은 이름의 다른 자동 실행 작업이므로 변경하지 않았습니다: $taskName"
    }
    Enable-ScheduledTask -TaskName $taskName | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Host "[GugakSignage] 자동 실행을 켜고 watchdog을 시작했습니다."
    exit 0
}

if ($Restart) {
    if (-not $task) {
        throw "자동 실행 작업이 없습니다. installer\install.ps1 -ConfigureOnly로 다시 등록하세요."
    }
    if (-not (Test-ScheduledTaskOwnedByInstall -Task $task -InstallDir $installDir)) {
        throw "같은 이름의 다른 자동 실행 작업이므로 변경하지 않았습니다: $taskName"
    }
    Enable-ScheduledTask -TaskName $taskName | Out-Null
    & (Join-Path $installDir "ops\stop.ps1") -Quiet
    Start-ScheduledTask -TaskName $taskName
    Write-Host "[GugakSignage] watchdog을 수동으로 재시작했습니다."
}
