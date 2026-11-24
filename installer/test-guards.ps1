# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param([switch]$KeepArtifacts)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ops\install-common.ps1")
$repoRoot = Get-NormalizedPath -Path (Join-Path $PSScriptRoot "..")
$installScript = Join-Path $PSScriptRoot "install.ps1"
$uninstallScript = Join-Path $PSScriptRoot "uninstall.ps1"
$suffix = [Guid]::NewGuid().ToString("N").Substring(0, 8)
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "GugakSignage-guard-test-$suffix"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$results = [ordered]@{}

function Assert-Throws {
    param(
        [scriptblock]$Action,
        [string]$Description
    )
    try {
        & $Action
        throw "예외가 발생하지 않았습니다: $Description"
    } catch {
        if ($_.Exception.Message -like "예외가 발생하지 않았습니다:*") { throw }
        return $_.Exception.Message
    }
}

try {
    $equalDir = Join-Path $tempRoot "equal"
    $message = Assert-Throws -Description "설치 폴더와 같은 데이터 폴더" -Action {
        & $installScript -SourceDir $repoRoot -InstallDir $equalDir -DataDir $equalDir -NoStart -NoAutoStart -TaskName "GugakSignage-Guard-Equal-$suffix"
    }
    if (Test-Path -LiteralPath $equalDir) { throw "경로 위반인데 설치 폴더가 생성되었습니다." }
    $results.equalPathBlocked = $message

    $parentDir = Join-Path $tempRoot "parent"
    $insideData = Join-Path $parentDir "data"
    $message = Assert-Throws -Description "설치 폴더 내부 데이터 폴더" -Action {
        & $installScript -SourceDir $repoRoot -InstallDir $parentDir -DataDir $insideData -NoStart -NoAutoStart -TaskName "GugakSignage-Guard-Inside-$suffix"
    }
    if (Test-Path -LiteralPath $parentDir) { throw "내부 경로 위반인데 설치 폴더가 생성되었습니다." }
    $results.insidePathBlocked = $message

    $dotDotDir = Join-Path $tempRoot "dotdot"
    $dotDotData = Join-Path $dotDotDir "child\.."
    $message = Assert-Throws -Description ".. 정규화 후 같은 경로" -Action {
        & $installScript -SourceDir $repoRoot -InstallDir $dotDotDir -DataDir $dotDotData -NoStart -NoAutoStart -TaskName "GugakSignage-Guard-DotDot-$suffix"
    }
    if (Test-Path -LiteralPath $dotDotDir) { throw ".. 경로 위반인데 설치 폴더가 생성되었습니다." }
    $results.dotDotPathBlocked = $message

    $fakeApp = Join-Path $tempRoot "fake-app"
    $fakeTools = Join-Path $fakeApp "tools"
    $fakeOps = Join-Path $fakeApp "ops"
    New-Item -ItemType Directory -Path $fakeTools -Force | Out-Null
    New-Item -ItemType Directory -Path $fakeOps -Force | Out-Null
    Copy-Item -LiteralPath $uninstallScript -Destination (Join-Path $fakeTools "uninstall.ps1") -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "ops\install-common.ps1") -Destination (Join-Path $fakeOps "install-common.ps1") -Force
    Set-Content -LiteralPath (Join-Path $fakeApp "keep.txt") -Value "must remain" -Encoding ascii
    $fakeConfig = [ordered]@{
        product = "GugakSignage"
        installDir = $fakeApp
        dataDir = $fakeApp
        logDir = (Join-Path $fakeApp "logs")
        profileDir = (Join-Path $fakeApp "profile")
        taskName = "GugakSignage-Guard-Fake-$suffix"
        shortcuts = @()
    }
    [IO.File]::WriteAllText((Join-Path $fakeApp "install.json"), ($fakeConfig | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
    $message = Assert-Throws -Description "같은 설치·데이터 폴더 제거" -Action {
        & (Join-Path $fakeTools "uninstall.ps1") -RemoveData -KeepInstallFiles -Quiet
    }
    if (-not (Test-Path -LiteralPath (Join-Path $fakeApp "keep.txt"))) { throw "제거 가드가 데이터 파일을 삭제했습니다." }
    $results.uninstallEqualPathBlocked = $message

    $unsafeCases = @(
        (Join-Path $env:SystemRoot "System32\GugakSignage"),
        (Join-Path $env:ProgramFiles "GugakSignage\data"),
        (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "GugakSignage\data"),
        $env:USERPROFILE
    )
    foreach ($unsafePath in $unsafeCases) {
        $null = Assert-Throws -Description "안전하지 않은 데이터 삭제 경로 $unsafePath" -Action {
            Assert-SafeDataRemovalTarget -DataDir $unsafePath
        }
    }
    $results.unsafeRemoveDataPathsBlocked = $unsafeCases.Count

    $foreignShortcutDir = Join-Path $tempRoot "foreign-desktop"
    New-Item -ItemType Directory -Path $foreignShortcutDir -Force | Out-Null
    $foreignShortcut = Join-Path $foreignShortcutDir "GugakSignage.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($foreignShortcut)
    $shortcut.TargetPath = Join-Path $env:SystemRoot "System32\notepad.exe"
    $shortcut.Save()
    if (Test-ShortcutOwnedByInstall -ShortcutPath $foreignShortcut -InstallDir (Join-Path $tempRoot "owner-app")) {
        throw "다른 프로그램 바로가기를 GugakSignage 소유로 판정했습니다."
    }
    $results.foreignShortcutDetected = $true

    $fakeTask = [pscustomobject]@{
        Description = "Unrelated task"
        Actions = @([pscustomobject]@{
            Execute = (Join-Path $env:SystemRoot "System32\cmd.exe")
            Arguments = "/c exit 0"
            WorkingDirectory = $tempRoot
        })
    }
    if (Test-ScheduledTaskOwnedByInstall -Task $fakeTask -InstallDir (Join-Path $tempRoot "owner-app")) {
        throw "다른 작업 스케줄러 항목을 GugakSignage 소유로 판정했습니다."
    }
    $results.foreignScheduledTaskDetected = $true

    $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
    $actualStart = ([DateTime]$currentProcess.CreationDate).ToUniversalTime().ToString("o")
    $verified = Get-VerifiedOwnedProcess -ProcessId $PID -ExpectedExecutable ([string]$currentProcess.ExecutablePath) -ExpectedStartTime $actualStart -CommandLineContains @("powershell")
    if (-not $verified) { throw "현재 PowerShell 프로세스의 정상 소유권 검증이 실패했습니다." }
    $wrongTime = ([DateTime]$currentProcess.CreationDate).AddHours(-2).ToUniversalTime().ToString("o")
    if (Get-VerifiedOwnedProcess -ProcessId $PID -ExpectedExecutable ([string]$currentProcess.ExecutablePath) -ExpectedStartTime $wrongTime -CommandLineContains @("powershell")) {
        throw "잘못된 시작 시각을 가진 PID를 소유 프로세스로 판정했습니다."
    }
    if (Get-VerifiedOwnedProcess -ProcessId $PID -ExpectedExecutable (Join-Path $env:SystemRoot "System32\notepad.exe") -ExpectedStartTime $actualStart -CommandLineContains @("powershell")) {
        throw "다른 실행 파일을 가진 PID를 소유 프로세스로 판정했습니다."
    }
    $null = Assert-Throws -Description "검증 실패 프로세스 종료 거부" -Action {
        Stop-VerifiedOwnedProcess -ProcessId $PID -ExpectedExecutable (Join-Path $env:SystemRoot "System32\notepad.exe") -ExpectedStartTime $actualStart -CommandLineContains @("powershell")
    }
    $results.pidIdentityMismatchBlocked = $true

    $results.result = "passed"
    $results | ConvertTo-Json -Depth 5 -Compress
} finally {
    if (-not $KeepArtifacts) {
        $tempBase = Get-NormalizedPath -Path ([IO.Path]::GetTempPath())
        $resolved = Get-NormalizedPath -Path $tempRoot
        if ($resolved.StartsWith($tempBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
            ([IO.Path]::GetFileName($resolved).StartsWith("GugakSignage-guard-test-"))) {
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "Guard artifacts: $tempRoot"
    }
}
