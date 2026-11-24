# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [switch]$Enable,
    [switch]$Disable,
    [switch]$Status,
    [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"
$installDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$configPath = Join-Path $installDir "install.json"
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "install.json을 찾지 못했습니다: $configPath"
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$taskName = [string]$config.taskName
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($Enable -and $Disable) { throw "-Enable와 -Disable은 함께 사용할 수 없습니다." }
if (-not $Enable -and -not $Disable) { $Status = $true }

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
    exit 0
}

if ($Disable) {
    if ($task) {
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
    Enable-ScheduledTask -TaskName $taskName | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Host "[GugakSignage] 자동 실행을 켜고 watchdog을 시작했습니다."
}
