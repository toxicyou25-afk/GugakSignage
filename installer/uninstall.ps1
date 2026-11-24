# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [switch]$RemoveData,
    [switch]$KeepInstallFiles,
    [switch]$InnoUninstall,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$commonPath = Join-Path $PSScriptRoot "ops\install-common.ps1"
if (-not (Test-Path -LiteralPath $commonPath)) {
    $commonPath = Join-Path $PSScriptRoot "..\ops\install-common.ps1"
}
. $commonPath

$configPath = Join-Path $PSScriptRoot "..\install.json"
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "install.json을 찾지 못했습니다: $configPath"
}
$config = Read-JsonFile -Path $configPath
if ([string]$config.product -ne "GugakSignage") {
    throw "GugakSignage 설치 정보가 아닙니다: $configPath"
}
$installDir = Get-NormalizedPath -Path ([string]$config.installDir)
$expectedInstallDir = Get-NormalizedPath -Path (Join-Path $PSScriptRoot "..")
if (-not (Test-PathEqual -Left $installDir -Right $expectedInstallDir)) {
    throw "설치 정보의 경로가 현재 제거 도구와 일치하지 않습니다."
}
$dataDir = Get-NormalizedPath -Path ([string]$config.dataDir)
$logDir = Get-NormalizedPath -Path ([string]$config.logDir)
$profileDir = Get-NormalizedPath -Path ([string]$config.profileDir)

Assert-DataDirOutsideInstall -InstallDir $installDir -DataDir $dataDir
if ($RemoveData) {
    Assert-SafeDataRemovalTarget -DataDir $dataDir -ProtectedPaths @($installDir, $profileDir)
}

$systemRoot = Get-NormalizedPath -Path $env:SystemRoot
$userProfile = Get-NormalizedPath -Path $env:USERPROFILE
$documentsRoots = @(
    [Environment]::GetFolderPath("Desktop"),
    [Environment]::GetFolderPath("MyDocuments"),
    [Environment]::GetFolderPath("MyPictures"),
    [Environment]::GetFolderPath("MyVideos")
) | Where-Object { $_ } | ForEach-Object { Get-NormalizedPath -Path $_ }
if ($installDir.Equals([IO.Path]::GetPathRoot($installDir), [StringComparison]::OrdinalIgnoreCase) -or
    $installDir.Equals($userProfile, [StringComparison]::OrdinalIgnoreCase) -or
    (Test-PathWithin -Path $installDir -Parent $systemRoot)) {
    throw "안전하지 않은 설치 폴더 경로라 자동 삭제하지 않습니다: $installDir"
}
foreach ($documentsRoot in $documentsRoots) {
    if ((Test-PathEqual -Left $installDir -Right $documentsRoot) -or (Test-PathWithin -Path $installDir -Parent $documentsRoot)) {
        throw "사용자 문서 폴더 안의 경로는 자동 삭제하지 않습니다: $installDir"
    }
}
if ((Get-PathDepthBelowRoot -Path $installDir) -lt 2) {
    throw "너무 얕은 설치 폴더는 자동 삭제하지 않습니다: $installDir"
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

function Remove-ExactShortcut {
    param([string]$ShortcutPath)
    if (-not $ShortcutPath) { return }
    $fullPath = [IO.Path]::GetFullPath($ShortcutPath)
    if ([IO.Path]::GetFileName($fullPath) -ne "GugakSignage.lnk") { return }
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { return }
    if (-not (Test-ShortcutOwnedByInstall -ShortcutPath $fullPath -InstallDir $installDir)) {
        Write-Warning "다른 프로그램의 바로가기로 보여 남겨 둡니다: $fullPath"
        return
    }
    Remove-Item -LiteralPath $fullPath -Force
    Write-Step "바로가기 제거: $fullPath"
}

try {
    Write-Step "제거 시작 (데이터 보존이 기본)"
    $controlDir = Join-Path $dataDir "control"
    New-Item -ItemType Directory -Path $controlDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $controlDir "stop.request") -Value ([DateTime]::UtcNow.ToString("o")) -Encoding ascii

    $statePath = Join-Path $logDir "watchdog-state.json"
    $state = if (Test-Path -LiteralPath $statePath) {
        Read-JsonFile -Path $statePath
    } else {
        $null
    }
    if ($state -and $state.watchdogPid) {
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        while ([DateTime]::UtcNow -lt $deadline) {
            $watchdog = Get-VerifiedOwnedProcess -ProcessId ([int]$state.watchdogPid) -ExpectedExecutable ([string]$config.nodePath) -ExpectedStartTime ([string]$state.watchdogStartedAt) -CommandLineContains @($installDir, "watchdog.mjs")
            if (-not $watchdog) { break }
            Start-Sleep -Milliseconds 250
        }
    }

    if ($config.taskName) {
        $task = Get-ScheduledTask -TaskName ([string]$config.taskName) -ErrorAction SilentlyContinue
        if ($task) {
            if (-not (Test-ScheduledTaskOwnedByInstall -Task $task -InstallDir $installDir)) {
                Write-Warning "다른 프로그램의 작업으로 보여 남겨 둡니다: $($config.taskName)"
            } else {
                Stop-ScheduledTask -TaskName ([string]$config.taskName) -ErrorAction SilentlyContinue
                Unregister-ScheduledTask -TaskName ([string]$config.taskName) -Confirm:$false
                Write-Step "자동 실행 작업 제거: $($config.taskName)"
            }
        }
    }

    if ($state) {
        if ($state.serverPid -and (Stop-VerifiedOwnedProcess -ProcessId ([int]$state.serverPid) -ExpectedExecutable ([string]$config.nodePath) -ExpectedStartTime ([string]$state.serverStartedAt) -CommandLineContains @($installDir, "dist\server.js"))) {
            Write-Step "남아 있던 서버 프로세스 종료: $($state.serverPid)"
        }
        if ($state.browserPid -and (Stop-VerifiedOwnedProcess -ProcessId ([int]$state.browserPid) -ExpectedExecutable ([string]$config.browserPath) -ExpectedStartTime ([string]$state.browserStartedAt) -CommandLineContains @($profileDir))) {
            Write-Step "남아 있던 재생기 프로세스 종료: $($state.browserPid)"
        }
        if ($state.watchdogPid -and (Stop-VerifiedOwnedProcess -ProcessId ([int]$state.watchdogPid) -ExpectedExecutable ([string]$config.nodePath) -ExpectedStartTime ([string]$state.watchdogStartedAt) -CommandLineContains @($installDir, "watchdog.mjs"))) {
            Write-Step "남아 있던 watchdog 프로세스 종료: $($state.watchdogPid)"
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

    if (-not $KeepInstallFiles -and -not $InnoUninstall) {
        if (-not (Test-Path -LiteralPath $configPath)) {
            throw "설치 확인 파일이 사라져 설치 폴더를 자동 삭제하지 않습니다."
        }
        Write-Step "설치 파일 제거: $installDir"
        Remove-Item -LiteralPath $installDir -Recurse -Force
    } elseif ($InnoUninstall) {
        $legacyInstallEnv = Join-Path $installDir ".env"
        $dataEnv = Join-Path $dataDir ".env"
        if ((Test-Path -LiteralPath $legacyInstallEnv -PathType Leaf) -and
            (Test-Path -LiteralPath $dataEnv -PathType Leaf)) {
            Remove-Item -LiteralPath $legacyInstallEnv -Force
            Write-Step "legacy 설치 폴더 .env 제거(데이터 폴더 .env 보존)"
        }
        Write-Step "Inno Setup이 설치 파일을 제거하도록 남겨 둡니다."
    } else {
        Write-Step "설치 파일 보존 옵션이 적용되었습니다."
    }

    if ($RemoveData) {
        Assert-SafeDataRemovalTarget -DataDir $dataDir -ProtectedPaths @($installDir, $profileDir)
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
