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
    $hangulDataName = [string]::Concat([char]0xAE30, [char]0xAD00, " ", [char]0xB370, [char]0xC774, [char]0xD130)
    $legacyApp = Join-Path $tempRoot "legacy-app"
    $legacyData = Join-Path (Join-Path $tempRoot $hangulDataName) "Gugak Signage"
    $defaultData = Join-Path $tempRoot "default-data"
    New-Item -ItemType Directory -Path $legacyApp, (Join-Path $legacyData "uploads") -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $legacyData "signage.sqlite"), "legacy-db")
    $escapedLegacyData = $legacyData.Replace("\", "\\")
    $legacyEnv = "DATA_DIR=`"$escapedLegacyData`"`r`nADMIN_PASSWORD=0000`r`nSEED_SAMPLES=true`r`n"
    [IO.File]::WriteAllText((Join-Path $legacyApp ".env"), $legacyEnv, [Text.UTF8Encoding]::new($false))

    $resolved = Resolve-InstallerDataDir -InstallDir $legacyApp -DefaultDataDir $defaultData
    if (-not (Test-PathEqual -Left ([string]$resolved.DataDir) -Right $legacyData)) {
        throw "install.json 없는 legacy DATA_DIR를 찾지 못했습니다: $($resolved.DataDir)"
    }
    if ([string]$resolved.Source -ne "install-env") {
        throw "legacy 데이터 경로의 출처가 잘못되었습니다: $($resolved.Source)"
    }
    if (Test-Path -LiteralPath $defaultData) { throw "legacy 경로 검색이 기본 데이터 폴더를 만들었습니다." }
    $results.legacyEnvOnlyDataDirResolved = $true
    $results.legacyEscapedUnicodePathResolved = $true
    $argumentValues = @(Get-DataDirArgumentValues -Arguments ('watchdog.exe -DataDir "' + $escapedLegacyData + '" /PORT=3000'))
    if ($argumentValues.Count -ne 1 -or -not (Test-PathEqual -Left ([string]$argumentValues[0]) -Right $legacyData)) {
        throw "legacy 작업/바로가기 인자의 DATA_DIR를 해석하지 못했습니다."
    }
    $results.legacyTaskShortcutArgumentParsed = $true

    $resolverOutputFile = Join-Path $tempRoot "resolver-output.txt"
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "ops\resolve-data-dir.ps1") -InstallDir $legacyApp -DefaultDataDir $defaultData -OutputFile $resolverOutputFile
    if ($LASTEXITCODE -ne 0) { throw "공유 경로 resolver helper가 실패했습니다." }
    $resolverTransport = [IO.File]::ReadAllText($resolverOutputFile)
    if ($resolverTransport -notmatch '^OK\|([0-9A-F]+)\|1$') { throw "공유 경로 resolver helper 응답이 잘못되었습니다: $resolverTransport" }
    $hex = $Matches[1]
    $bytes = [byte[]]::new($hex.Length / 2)
    for ($index = 0; $index -lt $bytes.Length; $index++) { $bytes[$index] = [Convert]::ToByte($hex.Substring($index * 2, 2), 16) }
    $transportDataDir = [Text.Encoding]::Unicode.GetString($bytes)
    if (-not (Test-PathEqual -Left $transportDataDir -Right $legacyData)) { throw "공유 경로 resolver의 Unicode 전달이 잘못되었습니다." }
    $results.innoSharedResolverTransportPreservesUnicode = $true

    $manifestPath = Join-Path $legacyApp "install.json"
    $relativeData = Join-Path $tempRoot "relative-data"
    New-Item -ItemType Directory -Path (Join-Path $relativeData "uploads") -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $relativeData "signage.sqlite"), "relative-db")
    $relativeConfig = [ordered]@{ dataDir = "..\relative-data" }
    [IO.File]::WriteAllText($manifestPath, ($relativeConfig | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    $relativeEnv = "DATA_DIR=`"..\relative-data`"`r`n"
    [IO.File]::WriteAllText((Join-Path $legacyApp ".env"), $relativeEnv, [Text.UTF8Encoding]::new($false))
    $resolved = Resolve-InstallerDataDir -InstallDir $legacyApp -DefaultDataDir $defaultData
    if (-not (Test-PathEqual -Left ([string]$resolved.DataDir) -Right $relativeData) -or
        [string]$resolved.Source -ne "install.json") {
        throw "상대 install.json 데이터 경로를 우선 해석하지 못했습니다."
    }
    $results.relativeInstallConfigHasPriority = $true

    $staleConfig = [ordered]@{ dataDir = "..\missing-legacy-data" }
    [IO.File]::WriteAllText($manifestPath, ($staleConfig | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    Remove-Item -LiteralPath (Join-Path $legacyApp ".env") -Force
    New-Item -ItemType Directory -Path (Join-Path $defaultData "uploads") -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $defaultData "signage.sqlite"), "known-default-db")
    $message = Assert-Throws -Description "stale install.json missing data path" -Action {
        Resolve-InstallerDataDir -InstallDir $legacyApp -DefaultDataDir $defaultData
    }
    if ($message -notmatch "찾지 못|중단|missing") { throw "stale install.json 오류가 명확하지 않습니다: $message" }
    $results.staleConfigFailsClosedEvenWithDefaultData = $true
    $staleResolverOutput = Join-Path $tempRoot "stale-resolver-output.txt"
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "ops\resolve-data-dir.ps1") -InstallDir $legacyApp -DefaultDataDir $defaultData -OutputFile $staleResolverOutput
    if ($LASTEXITCODE -eq 0) { throw "stale install.json이 resolver에서 허용되었습니다." }
    if (-not ([IO.File]::ReadAllText($staleResolverOutput).StartsWith("ERR|"))) { throw "stale resolver가 ERR 응답을 남기지 않았습니다." }
    $results.staleResolverFailsClosed = $true

    $freshDefaultRoot = Join-Path $tempRoot "fresh-default-root"
    $freshDefaultData = Join-Path $freshDefaultRoot "GugakSignage"
    New-Item -ItemType Directory -Path (Join-Path $freshDefaultData "uploads") -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $freshDefaultData "signage.sqlite"), "existing-default-db")
    $freshDefaultHash = (Get-FileHash -LiteralPath (Join-Path $freshDefaultData "signage.sqlite") -Algorithm SHA256).Hash
    $freshDefaultResolution = Resolve-InstallerDataDir -InstallDir (Join-Path $tempRoot "fresh-no-manifest") -DefaultDataDir $freshDefaultData
    if ($freshDefaultResolution.HasPreviousEvidence -or -not $freshDefaultResolution.HasExistingData) {
        throw "fresh 기본 데이터 폴더의 evidence/content 구분이 잘못되었습니다."
    }
    $freshResolverOutput = Join-Path $tempRoot "fresh-resolver-output.txt"
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "ops\resolve-data-dir.ps1") -InstallDir (Join-Path $tempRoot "fresh-no-manifest") -DefaultDataDir $freshDefaultData -OutputFile $freshResolverOutput
    if ($LASTEXITCODE -ne 0 -or [IO.File]::ReadAllText($freshResolverOutput) -notmatch '\|0$') {
        throw "fresh 기본 데이터 폴더를 기존 설치로 잘못 판정했습니다."
    }
    $results.freshDefaultDataIsNotPreviousEvidence = $true

    $freshExplicitApp = Join-Path $tempRoot "fresh-explicit-app"
    $freshExplicitData = Join-Path $tempRoot "fresh-explicit-data"
    $originalLocalAppData = $env:LOCALAPPDATA
    $originalProgramData = $env:ProgramData
    $env:LOCALAPPDATA = $freshDefaultRoot
    $env:ProgramData = $freshDefaultRoot
    try {
        & $installScript -SourceDir $repoRoot -InstallDir $freshExplicitApp -DataDir $freshExplicitData -Port 39123 -TaskName "GugakSignage-Guard-Fresh-$suffix" -DesktopDir (Join-Path $tempRoot "fresh-desktop") -StartMenuDir (Join-Path $tempRoot "fresh-start-menu") -ProfileDir (Join-Path $tempRoot "fresh-profile") -NoStart -NoAutoStart | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "fresh install + explicit DATADIR가 실패했습니다." }
    } finally {
        $env:LOCALAPPDATA = $originalLocalAppData
        $env:ProgramData = $originalProgramData
    }
    $freshConfig = Read-JsonFile -Path (Join-Path $freshExplicitApp "install.json")
    if (-not (Test-PathEqual -Left ([string]$freshConfig.dataDir) -Right $freshExplicitData)) {
        throw "fresh explicit DATADIR가 install.json에 반영되지 않았습니다."
    }
    $freshEnvText = [IO.File]::ReadAllText((Join-Path $freshExplicitData ".env"))
    if ($freshEnvText -notmatch "(?m)^SEED_SAMPLES=true\s*$") {
        throw "fresh explicit DATADIR가 새 데이터인데 샘플 시드가 꺼졌습니다."
    }
    if ((Get-FileHash -LiteralPath (Join-Path $freshDefaultData "signage.sqlite") -Algorithm SHA256).Hash -ne $freshDefaultHash) {
        throw "fresh explicit DATADIR 설치가 기본 데이터 폴더를 변경했습니다."
    }
    $results.freshExplicitDataDirAllowed = $true

    $conflictData = Join-Path $tempRoot "conflict-data"
    New-Item -ItemType Directory -Path (Join-Path $conflictData "uploads") -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $conflictData "signage.sqlite"), "conflict-db")
    $conflictConfig = [ordered]@{ dataDir = $relativeData }
    [IO.File]::WriteAllText($manifestPath, ($conflictConfig | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $legacyApp ".env"), ("DATA_DIR=`"$conflictData`"`r`n"), [Text.UTF8Encoding]::new($false))
    $message = Assert-Throws -Description "install.json/.env 경로 충돌" -Action {
        Resolve-InstallerDataDir -InstallDir $legacyApp -DefaultDataDir $defaultData
    }
    if ($message -notmatch "충돌|conflict") { throw "경로 충돌 오류가 명확하지 않습니다: $message" }
    $results.configEnvConflictBlocked = $true

    $insideConfig = [ordered]@{ dataDir = ".\data" }
    [IO.File]::WriteAllText($manifestPath, ($insideConfig | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $legacyApp ".env"), "", [Text.UTF8Encoding]::new($false))
    $message = Assert-Throws -Description "install 폴더 내부 legacy 데이터 경로" -Action {
        Resolve-InstallerDataDir -InstallDir $legacyApp -DefaultDataDir $defaultData
    }
    if ($message -notmatch "설치 폴더|install") { throw "내부 데이터 경로 오류가 명확하지 않습니다: $message" }
    $results.legacyDataInsideInstallBlocked = $true

    $fallbackProfile = Join-Path $env:USERPROFILE "GugakSignage-ServiceProfile-$suffix"
    $fallbackDocuments = Get-UserDocumentsPath -KnownFolderPath "" -UserProfilePath $fallbackProfile
    $expectedDocuments = Join-Path $fallbackProfile "Documents"
    if (-not (Test-PathEqual -Left $fallbackDocuments -Right $expectedDocuments)) {
        throw "제한 계정의 Documents 경로 fallback이 잘못되었습니다: $fallbackDocuments"
    }
    $null = Assert-Throws -Description "fallback Documents data removal blocked" -Action {
        Assert-SafeDataRemovalTarget -DataDir (Join-Path $fallbackDocuments "GugakSignage\data") -ProtectedPaths @($fallbackDocuments)
    }
    $results.restrictedProfileDocumentsPathBlocked = $true

    $equalDir = Join-Path $tempRoot "equal"
    $message = Assert-Throws -Description "설치 폴더와 같은 데이터 폴더" -Action {
        & $installScript -SourceDir $repoRoot -InstallDir $equalDir -DataDir $equalDir -NoStart -NoAutoStart -TaskName "GugakSignage-Guard-Equal-$suffix"
    }
    if (Test-Path -LiteralPath $equalDir) { throw "경로 위반인데 설치 폴더가 생성되었습니다." }
    if ($message -notmatch "데이터 폴더는 설치 폴더와 같거나") { throw "equal 경로 guard가 아닌 오류가 났습니다: $message" }
    $results.equalPathBlocked = $message

    $parentDir = Join-Path $tempRoot "parent"
    $insideData = Join-Path $parentDir "data"
    $message = Assert-Throws -Description "설치 폴더 내부 데이터 폴더" -Action {
        & $installScript -SourceDir $repoRoot -InstallDir $parentDir -DataDir $insideData -NoStart -NoAutoStart -TaskName "GugakSignage-Guard-Inside-$suffix"
    }
    if (Test-Path -LiteralPath $parentDir) { throw "내부 경로 위반인데 설치 폴더가 생성되었습니다." }
    if ($message -notmatch "데이터 폴더는 설치 폴더와 같거나") { throw "inside 경로 guard가 아닌 오류가 났습니다: $message" }
    $results.insidePathBlocked = $message

    $reverseData = Join-Path $tempRoot "reverse-data"
    $reverseApp = Join-Path $reverseData "app"
    $message = Assert-Throws -Description "설치 폴더가 데이터 폴더 안에 있는 경로" -Action {
        & $installScript -SourceDir $repoRoot -InstallDir $reverseApp -DataDir $reverseData -NoStart -NoAutoStart -TaskName "GugakSignage-Guard-Reverse-$suffix"
    }
    if ($message -notmatch "데이터 폴더는 설치 폴더와 같거나") { throw "reverse 경로 guard가 아닌 오류가 났습니다: $message" }
    $results.reverseNestingBlocked = $message

    $dotDotDir = Join-Path $tempRoot "dotdot"
    $dotDotData = Join-Path $dotDotDir "child\.."
    $message = Assert-Throws -Description ".. 정규화 후 같은 경로" -Action {
        & $installScript -SourceDir $repoRoot -InstallDir $dotDotDir -DataDir $dotDotData -NoStart -NoAutoStart -TaskName "GugakSignage-Guard-DotDot-$suffix"
    }
    if (Test-Path -LiteralPath $dotDotDir) { throw ".. 경로 위반인데 설치 폴더가 생성되었습니다." }
    if ($message -notmatch "데이터 폴더는 설치 폴더와 같거나") { throw "dotdot 경로 guard가 아닌 오류가 났습니다: $message" }
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
        (Join-Path (Get-UserDocumentsPath) "GugakSignage\data"),
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

    $adminOwnerApp = Join-Path $tempRoot "admin-owner-app"
    $adminOwnerOps = Join-Path $adminOwnerApp "ops"
    New-Item -ItemType Directory -Path $adminOwnerOps -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $adminOwnerOps "admin-launch.vbs") -Value "' fixture" -Encoding ascii
    $adminShortcutDir = Join-Path $tempRoot "admin-desktop"
    New-Item -ItemType Directory -Path $adminShortcutDir -Force | Out-Null
    $adminShortcutPath = Join-Path $adminShortcutDir "GugakSignage 관리자.lnk"
    $adminShortcut = $shell.CreateShortcut($adminShortcutPath)
    $adminShortcut.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
    $adminShortcut.Arguments = '//B //NoLogo "' + (Join-Path $adminOwnerOps "admin-launch.vbs") + '"'
    $adminShortcut.WorkingDirectory = $adminOwnerApp
    $adminShortcut.Save()
    if (-not (Test-AdminShortcutOwnedByInstall -ShortcutPath $adminShortcutPath -InstallDir $adminOwnerApp)) {
        throw "GugakSignage 관리자 바로가기 소유권을 확인하지 못했습니다."
    }
    $foreignAdminShortcut = Join-Path $adminShortcutDir "foreign-admin.lnk"
    $foreignAdmin = $shell.CreateShortcut($foreignAdminShortcut)
    $foreignAdmin.TargetPath = Join-Path $env:SystemRoot "System32\notepad.exe"
    $foreignAdmin.Save()
    if (Test-AdminShortcutOwnedByInstall -ShortcutPath $foreignAdminShortcut -InstallDir $adminOwnerApp) {
        throw "다른 프로그램 바로가기를 GugakSignage 관리자 소유로 판정했습니다."
    }
    $results.adminShortcutTargetVerified = $true

    $adminPortApp = Join-Path $tempRoot "admin-port-app"
    New-Item -ItemType Directory -Path $adminPortApp -Force | Out-Null
    $openAdminScript = Join-Path $PSScriptRoot "ops\open-admin.ps1"
    $defaultAdminUrl = (& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $openAdminScript -InstallDir $adminPortApp -PrintOnly | Out-String).Trim()
    if ($defaultAdminUrl -ne "http://127.0.0.1:3000/admin/") { throw "install.json 없는 관리자 URL fallback이 잘못되었습니다: $defaultAdminUrl" }
    [IO.File]::WriteAllText((Join-Path $adminPortApp "install.json"), '{ "port": 4123 }', [Text.UTF8Encoding]::new($false))
    $configuredAdminUrl = (& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $openAdminScript -InstallDir $adminPortApp -PrintOnly | Out-String).Trim()
    if ($configuredAdminUrl -ne "http://127.0.0.1:4123/admin/") { throw "install.json 포트의 관리자 URL이 잘못되었습니다: $configuredAdminUrl" }
    [IO.File]::WriteAllText((Join-Path $adminPortApp "install.json"), '{ "port": 70000 }', [Text.UTF8Encoding]::new($false))
    $invalidAdminUrl = (& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $openAdminScript -InstallDir $adminPortApp -PrintOnly | Out-String).Trim()
    if ($invalidAdminUrl -ne "http://127.0.0.1:3000/admin/") { throw "잘못된 포트의 관리자 URL fallback이 잘못되었습니다: $invalidAdminUrl" }
    $results.adminUrlPortFallback = $true

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

    $testProcessId = 424242
    $currentProcess = [pscustomobject]@{
        ExecutablePath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
        CommandLine = "powershell.exe -NoLogo -NoProfile -File test-guards.ps1"
        CreationDate = [DateTime]::UtcNow.ToString("o")
    }
    function Get-CimInstance {
        [CmdletBinding()]
        param([string]$ClassName, [string]$Filter)
        if ($ClassName -ne "Win32_Process" -or $Filter -notmatch "ProcessId\s*=\s*$testProcessId\b") { return }
        $currentProcess
    }
    $actualStart = ([DateTime]$currentProcess.CreationDate).ToUniversalTime().ToString("o")
    $verified = Get-VerifiedOwnedProcess -ProcessId $testProcessId -ExpectedExecutable ([string]$currentProcess.ExecutablePath) -ExpectedStartTime $actualStart -CommandLineContains @("powershell")
    if (-not $verified) { throw "현재 프로세스 메타데이터의 정상 소유권 검증이 실패했습니다." }
    $processWithPath = $currentProcess
    $currentProcess = [pscustomobject]@{
        ExecutablePath = ""
        CommandLine = '"' + $processWithPath.ExecutablePath + '" -NoLogo -NoProfile -File C:\GugakSignage\dist\server.js'
        CreationDate = $processWithPath.CreationDate
    }
    $verifiedFromCommandLine = Get-VerifiedOwnedProcess -ProcessId $testProcessId -ExpectedExecutable ([string]$processWithPath.ExecutablePath) -ExpectedStartTime $actualStart -CommandLineContains @("C:\GugakSignage", "dist\server.js")
    $currentProcess = $processWithPath
    if (-not $verifiedFromCommandLine) { throw "실행 파일 경로가 비어 있는 프로세스의 정확한 명령행 신원 검증이 실패했습니다." }
    $results.processIdentityFromCommandLineWhenExecutablePathUnavailable = $true
    $currentProcess = [pscustomobject]@{
        ExecutablePath = ""
        CommandLine = '"' + (Join-Path $env:SystemRoot "System32\notepad.exe") + '" -NoLogo -NoProfile -File C:\GugakSignage\dist\server.js'
        CreationDate = $processWithPath.CreationDate
    }
    if (Get-VerifiedOwnedProcess -ProcessId $testProcessId -ExpectedExecutable ([string]$processWithPath.ExecutablePath) -ExpectedStartTime $actualStart -CommandLineContains @("C:\GugakSignage", "dist\server.js")) {
        throw "실행 파일 경로가 비어 있어도 다른 첫 실행 파일을 소유 프로세스로 판정했습니다."
    }
    $currentProcess = $processWithPath
    $results.foreignCommandLineExecutableBlocked = $true
    $nativeProcess = Get-Process -Id $PID -ErrorAction Stop
    $nativeStart = $nativeProcess.StartTime.ToUniversalTime().ToString("o")
    $ownedInstallDir = Join-Path $tempRoot "state-owned-process-app"
    $ownedDataDir = Join-Path $tempRoot "state-owned-process-data"
    $ownedLogDir = Join-Path $ownedDataDir "logs"
    $ownedControlDir = Join-Path $ownedDataDir "control"
    New-Item -ItemType Directory -Path $ownedInstallDir, $ownedLogDir, $ownedControlDir -Force | Out-Null
    $ownedInstanceId = "state-owned-process-test"
    [IO.File]::WriteAllText((Join-Path $ownedInstallDir "install.json"), (@{
        product = "GugakSignage"; installDir = $ownedInstallDir; dataDir = $ownedDataDir; logDir = $ownedLogDir
    } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $ownedLogDir "watchdog-state.json"), (@{
        serverPid = $PID; serverStartedAt = $nativeStart; serverInstanceId = $ownedInstanceId
    } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $ownedControlDir "server-instance.json"), (@{
        id = $ownedInstanceId; pid = $PID; startedAt = $nativeStart
    } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    $testProcessId = $PID
    $currentProcess = [pscustomobject]@{
        ExecutablePath = ""
        CommandLine = ""
        CreationDate = $nativeProcess.StartTime
    }
    $verifiedFromInstallState = Get-VerifiedOwnedProcess -ProcessId $testProcessId -ExpectedExecutable ([string]$nativeProcess.Path) -ExpectedStartTime $nativeStart -CommandLineContains @($ownedInstallDir, "dist\server.js") -InstallDir $ownedInstallDir
    if (-not $verifiedFromInstallState) { throw "CIM 실행 파일 경로와 명령행이 비어 있어도 설치 상태, PID, 시작 시각으로 프로세스 신원을 확인해야 합니다." }
    $results.processIdentityFromInstallStateWhenCimMetadataUnavailable = $true
    $currentState = Read-JsonFile -Path (Join-Path $ownedLogDir "watchdog-state.json")
    $currentState.serverInstanceId = $null
    [IO.File]::WriteAllText((Join-Path $ownedLogDir "watchdog-state.json"), ($currentState | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    if (-not (Get-VerifiedOwnedProcess -ProcessId $testProcessId -ExpectedExecutable ([string]$nativeProcess.Path) -ExpectedStartTime $nativeStart -CommandLineContains @($ownedInstallDir, "dist\server.js") -InstallDir $ownedInstallDir)) {
        throw "이전 watchdog 상태에 serverInstanceId가 없어도 서버 인스턴스 파일의 PID·시작 시각을 확인하면 소유 프로세스로 판정해야 합니다."
    }
    $results.legacyInstallStateProcessIdentityVerified = $true
    $currentState.serverInstanceId = $ownedInstanceId
    $currentState.serverPid = $PID + 1
    [IO.File]::WriteAllText((Join-Path $ownedLogDir "watchdog-state.json"), ($currentState | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    if (Get-VerifiedOwnedProcess -ProcessId $testProcessId -ExpectedExecutable ([string]$nativeProcess.Path) -ExpectedStartTime $nativeStart -CommandLineContains @($ownedInstallDir, "dist\server.js") -InstallDir $ownedInstallDir) {
        throw "설치 상태의 PID가 다르면 실행 파일과 시작 시각이 같아도 소유 프로세스로 판정하면 안 됩니다."
    }
    $results.mismatchedInstallStateBlocked = $true
    $testProcessId = 424242
    $currentProcess = $processWithPath
    $wrongTime = ([DateTime]$currentProcess.CreationDate).AddHours(-2).ToUniversalTime().ToString("o")
    if (Get-VerifiedOwnedProcess -ProcessId $testProcessId -ExpectedExecutable ([string]$currentProcess.ExecutablePath) -ExpectedStartTime $wrongTime -CommandLineContains @("powershell")) {
        throw "잘못된 시작 시각을 가진 PID를 소유 프로세스로 판정했습니다."
    }
    if (Get-VerifiedOwnedProcess -ProcessId $testProcessId -ExpectedExecutable (Join-Path $env:SystemRoot "System32\notepad.exe") -ExpectedStartTime $actualStart -CommandLineContains @("powershell")) {
        throw "다른 실행 파일을 가진 PID를 소유 프로세스로 판정했습니다."
    }
    $null = Assert-Throws -Description "검증 실패 프로세스 종료 거부" -Action {
        Stop-VerifiedOwnedProcess -ProcessId $testProcessId -ExpectedExecutable (Join-Path $env:SystemRoot "System32\notepad.exe") -ExpectedStartTime $actualStart -CommandLineContains @("powershell")
    }
    $results.pidIdentityMismatchBlocked = $true

    $results.result = "passed"
    $results | ConvertTo-Json -Depth 5 -Compress
} catch {
    Write-Output "Guard exception: $($_.Exception.ToString())"
    Write-Output "Position: $($_.InvocationInfo.PositionMessage)"
    Write-Output "Stack: $($_.ScriptStackTrace)"
    throw
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
