# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [switch]$RemoveData,
    [switch]$KeepInstallFiles,
    [switch]$InnoUninstall,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$configPath = Join-Path $PSScriptRoot "..\install.json"
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "install.json을 찾지 못했습니다: $configPath"
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$installDir = [IO.Path]::GetFullPath([string]$config.installDir)
$dataDir = [IO.Path]::GetFullPath([string]$config.dataDir)
$logDir = [IO.Path]::GetFullPath([string]$config.logDir)
$profileDir = [IO.Path]::GetFullPath([string]$config.profileDir)
$configInstallDir = [IO.Path]::GetFullPath($configPath)
if (-not $configInstallDir.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase)) {
    throw "설치 정보의 경로가 일치하지 않습니다."
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
$uninstallLog = Join-Path $logDir "uninstall-$stamp.log"
Start-Transcript -LiteralPath $uninstallLog -Append | Out-Null
$transcriptStarted = $true
$removeDataAfterStop = $false

function Write-Step {
    param([string]$Message)
    if (-not $Quiet) { Write-Host "[GugakSignage] $Message" }
}

function Get-OwnedProcess {
    param(
        [int]$ProcessId,
        [string[]]$Needles
    )
    if ($ProcessId -le 0) { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    $commandLine = [string]$process.CommandLine
    foreach ($needle in $Needles) {
        if ($needle -and $commandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return $process
        }
    }
    return $null
}

function Stop-OwnedProcess {
    param(
        [int]$ProcessId,
        [string[]]$Needles
    )
    $owned = Get-OwnedProcess -ProcessId $ProcessId -Needles $Needles
    if (-not $owned) { return $false }
    & taskkill.exe /PID $ProcessId /T /F *> $null
    return $true
}

function Remove-ExactShortcut {
    param([string]$ShortcutPath)
    if (-not $ShortcutPath) { return }
    $fullPath = [IO.Path]::GetFullPath($ShortcutPath)
    if ([IO.Path]::GetFileName($fullPath) -ne "GugakSignage.lnk") { return }
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        Remove-Item -LiteralPath $fullPath -Force
        Write-Step "바로가기 제거: $fullPath"
    }
}

try {
    Write-Step "제거 시작 (데이터 보존이 기본)"
    $controlDir = Join-Path $dataDir "control"
    New-Item -ItemType Directory -Path $controlDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $controlDir "stop.request") -Value ([DateTime]::UtcNow.ToString("o")) -Encoding ascii

    $statePath = Join-Path $logDir "watchdog-state.json"
    $state = if (Test-Path -LiteralPath $statePath) {
        Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    } else {
        $null
    }
    if ($state -and $state.watchdogPid) {
        $deadline = [DateTime]::UtcNow.AddSeconds(12)
        while ([DateTime]::UtcNow -lt $deadline) {
            $watchdog = Get-OwnedProcess -ProcessId ([int]$state.watchdogPid) -Needles @("watchdog.mjs")
            if (-not $watchdog) { break }
            Start-Sleep -Milliseconds 250
        }
    }

    if ($config.taskName) {
        $task = Get-ScheduledTask -TaskName ([string]$config.taskName) -ErrorAction SilentlyContinue
        if ($task) {
            Stop-ScheduledTask -TaskName ([string]$config.taskName) -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName ([string]$config.taskName) -Confirm:$false
            Write-Step "자동 실행 작업 제거: $($config.taskName)"
        }
    }

    if ($state) {
        if ($state.serverPid) {
            if (Stop-OwnedProcess -ProcessId ([int]$state.serverPid) -Needles @($installDir, "dist\server.js")) {
                Write-Step "남아 있던 서버 프로세스 종료: $($state.serverPid)"
            }
        }
        if ($state.browserPid) {
            if (Stop-OwnedProcess -ProcessId ([int]$state.browserPid) -Needles @($profileDir)) {
                Write-Step "남아 있던 재생기 프로세스 종료: $($state.browserPid)"
            }
        }
        if ($state.watchdogPid) {
            if (Stop-OwnedProcess -ProcessId ([int]$state.watchdogPid) -Needles @("watchdog.mjs")) {
                Write-Step "남아 있던 watchdog 프로세스 종료: $($state.watchdogPid)"
            }
        }
    }

    foreach ($shortcut in @($config.shortcuts)) {
        Remove-ExactShortcut -ShortcutPath ([string]$shortcut)
    }

    if ($config.firewallRuleName) {
        $rule = Get-NetFirewallRule -DisplayName ([string]$config.firewallRuleName) -ErrorAction SilentlyContinue
        if ($rule) {
            $description = [string]$rule.Description
            if ($description.Contains("GugakSignage installer")) {
                try {
                    Remove-NetFirewallRule -DisplayName ([string]$config.firewallRuleName)
                    Write-Step "방화벽 규칙 제거: $($config.firewallRuleName)"
                } catch {
                    Write-Warning "방화벽 규칙을 제거하지 못했습니다. 관리자 권한으로 다시 실행하세요: $($_.Exception.Message)"
                }
            }
        }
    }

    $dataInsideInstall = $dataDir.StartsWith($installDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    if ($dataInsideInstall -and -not $RemoveData) {
        throw "데이터 폴더가 설치 폴더 안에 있어 보존 제거를 안전하게 진행할 수 없습니다: $dataDir"
    }

    if (-not $KeepInstallFiles -and -not $InnoUninstall) {
        if (-not (Test-Path -LiteralPath $configPath)) {
            throw "설치 확인 파일이 사라져 설치 폴더를 자동 삭제하지 않습니다."
        }
        $installRoot = [IO.Path]::GetPathRoot($installDir)
        if ($installDir -eq $installRoot -or $installDir -eq $env:SystemRoot -or $installDir -eq $env:USERPROFILE) {
            throw "안전하지 않은 설치 폴더 경로라 자동 삭제하지 않습니다: $installDir"
        }
        Write-Step "설치 파일 제거: $installDir"
        Remove-Item -LiteralPath $installDir -Recurse -Force
    } elseif ($InnoUninstall) {
        Write-Step "Inno Setup이 설치 파일을 제거하도록 남겨 둡니다."
    } else {
        Write-Step "설치 파일 보존 옵션이 적용되었습니다."
    }

    if ($RemoveData) {
        $root = [IO.Path]::GetPathRoot($dataDir)
        if ($dataDir -eq $root -or $dataDir -eq $env:USERPROFILE) {
            throw "안전하지 않은 데이터 폴더 경로라 자동 삭제하지 않습니다: $dataDir"
        }
        Write-Step "명시적 요청에 따라 데이터 폴더 제거: $dataDir"
        $removeDataAfterStop = $true
    } else {
        Write-Step "사용자 데이터 보존: $dataDir"
    }

    Write-Step "제거 완료"
} catch {
    Write-Host "[GugakSignage] 제거 실패: $($_.Exception.Message)" -ForegroundColor Red
    throw
} finally {
    if ($transcriptStarted) {
        Stop-Transcript | Out-Null
    }
    if ($removeDataAfterStop -and (Test-Path -LiteralPath $dataDir)) {
        Remove-Item -LiteralPath $dataDir -Recurse -Force
    }
}
