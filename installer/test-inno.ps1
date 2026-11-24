# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$SetupExe = "",
    [switch]$KeepTestArtifacts
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
. (Join-Path $PSScriptRoot "ops\install-common.ps1")
$repoRoot = Get-NormalizedPath -Path (Join-Path $PSScriptRoot "..")
$evidenceDir = Join-Path $repoRoot "docs\install\evidence"
if (-not $SetupExe) { $SetupExe = Join-Path $PSScriptRoot "build\inno\GugakSignage-Setup-0.1.0.exe" }
$SetupExe = (Resolve-Path -LiteralPath $SetupExe).Path
if (-not (Test-Path -LiteralPath $SetupExe -PathType Leaf)) { throw "Inno Setup EXE가 없습니다: $SetupExe" }
$nodePath = (Get-Command "node.exe").Source
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null

function Get-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Test-ServerHealth {
    param([int]$PortNumber)
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(2)
    try {
        $content = $client.GetStringAsync("http://127.0.0.1:$PortNumber/api/health").GetAwaiter().GetResult()
        $health = $content | ConvertFrom-Json
        return ($health.ok -and $health.service -eq "gugak-signage")
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Wait-Until {
    param([scriptblock]$Condition, [int]$TimeoutSeconds, [string]$Description)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try { if (& $Condition) { return $true } } catch {}
        Start-Sleep -Milliseconds 500
    }
    throw "시간 초과: $Description"
}

function Get-StableFileHash {
    param([string]$Path)
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $deadline) {
        try { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash } catch {}
        Start-Sleep -Milliseconds 500
    }
    throw "파일 해시를 읽지 못했습니다: $Path"
}

function Sanitize-File {
    param([string]$Source, [string]$Destination)
    if (-not (Test-Path -LiteralPath $Source)) { return }
    $text = [IO.File]::ReadAllText($Source, [Text.Encoding]::UTF8)
    $variants = @($testRoot, $testRoot.Replace("\", "\\"), $testRoot.Replace("\", "/"))
    foreach ($variant in $variants) { $text = $text.Replace([string]$variant, "<test-root>") }
    foreach ($variant in @($repoRoot, $repoRoot.Replace("\", "\\"), $repoRoot.Replace("\", "/"))) {
        $text = $text.Replace([string]$variant, "<repo>")
    }
    $text = $text.Replace("$env:USERDOMAIN\$env:USERNAME", "<user>").Replace($env:USERNAME, "<user>").Replace($env:COMPUTERNAME, "<computer>")
    $text = [regex]::Replace($text, "[ \t]+\r?\n", [Environment]::NewLine).TrimEnd()
    Set-Content -LiteralPath $Destination -Value $text -Encoding utf8
}

function Sanitize-InnoLog {
    param([string]$Source, [string]$Destination)
    if (-not (Test-Path -LiteralPath $Source)) { return }
    $text = [IO.File]::ReadAllText($Source, [Text.Encoding]::UTF8)
    $variants = @($testRoot, $testRoot.Replace("\", "\\"), $testRoot.Replace("\", "/"))
    foreach ($variant in $variants) { $text = $text.Replace([string]$variant, "<test-root>") }
    foreach ($variant in @($repoRoot, $repoRoot.Replace("\", "\\"), $repoRoot.Replace("\", "/"))) {
        $text = $text.Replace([string]$variant, "<repo>")
    }
    $text = $text.Replace("$env:USERDOMAIN\$env:USERNAME", "<user>").Replace($env:USERNAME, "<user>").Replace($env:COMPUTERNAME, "<computer>")
    $lines = $text -split "\r?\n"
    $important = $lines | Where-Object {
        $_ -match "Setup command line|Run entry|Parameters:|Process exit code|InitializeWizard|PrepareToInstall|Installation process succeeded|Uninstallation process succeeded|Removed all\?|Need to restart Windows|Exception|Error|Dest filename: .*install\.json|DataDir|TaskName"
    }
    $excerpt = @(
        "# Relevant sanitized excerpt from the Inno Setup 6.7.3 execution log."
        $lines | Select-Object -First 60
        $important
        $lines | Select-Object -Last 100
    ) | Select-Object -Unique
    Set-Content -LiteralPath $Destination -Value ($excerpt -join [Environment]::NewLine) -Encoding utf8
}

function Get-ProductionPathSnapshot {
    $paths = @(
        (Join-Path $env:ProgramFiles "GugakSignage"),
        (Join-Path $env:ProgramData "GugakSignage")
    )
    return @($paths | ForEach-Object {
        $item = Get-Item -LiteralPath $_ -ErrorAction SilentlyContinue
        [ordered]@{
            name = [IO.Path]::GetFileName($_)
            exists = [bool]$item
            lastWriteUtc = if ($item) { $item.LastWriteTimeUtc.ToString("o") } else { $null }
        }
    })
}

$stamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
$suffix = [Guid]::NewGuid().ToString("N").Substring(0, 8)
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "GugakSignage-inno-test-$stamp-$suffix"
$installDir = Join-Path $testRoot "app"
$dataDir = Join-Path $testRoot "data"
$desktopDir = Join-Path $testRoot "desktop"
$startMenuDir = Join-Path $testRoot "start-menu"
$profileDir = Join-Path $testRoot "player-profile"
$taskName = "GugakSignage-InnoTest-$suffix"
$port = Get-FreePort
$installerLog = Join-Path $testRoot "inno-install.log"
$upgradeLog = Join-Path $testRoot "inno-upgrade.log"
$uninstallerLog = Join-Path $testRoot "inno-uninstall.log"
$startedAt = [DateTime]::UtcNow
$report = [ordered]@{
    startedAt = $startedAt.ToString("o")
    setupExeSize = (Get-Item -LiteralPath $SetupExe).Length
    setupExeSha256 = (Get-FileHash -LiteralPath $SetupExe -Algorithm SHA256).Hash.ToLowerInvariant()
    innoCompilerVersion = "6.7.3"
    port = $port
    taskName = $taskName
    result = "running"
    checks = [ordered]@{}
    productionPathsBefore = Get-ProductionPathSnapshot
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
try {
    $installArguments = '/CURRENTUSER /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="' + $installDir + '" /DATADIR="' + $dataDir + '" /PORT=' + $port + ' /WATCHDOGTASK="' + $taskName + '" /DESKTOPDIR="' + $desktopDir + '" /STARTMENUDIR="' + $startMenuDir + '" /PLAYERPROFILE="' + $profileDir + '" /LOG="' + $installerLog + '"'
    $installer = Start-Process -FilePath $SetupExe -ArgumentList $installArguments -Wait -PassThru -WindowStyle Hidden
    if ($installer.ExitCode -ne 0) { throw "Inno Setup 설치 실패: exit=$($installer.ExitCode), log=$installerLog" }
    Wait-Until -TimeoutSeconds 30 -Description "Inno 설치 파일" -Condition { Test-Path -LiteralPath (Join-Path $installDir "install.json") }
    $config = Get-Content -LiteralPath (Join-Path $installDir "install.json") -Raw | ConvertFrom-Json
    if (-not (Test-PathEqual -Left ([string]$config.installDir) -Right $installDir)) { throw "EXE 설치 경로가 격리 경로와 다릅니다." }
    if (-not (Test-PathEqual -Left ([string]$config.dataDir) -Right $dataDir)) { throw "EXE 데이터 경로가 /DATADIR와 다릅니다." }
    if ([string]$config.taskName -ne $taskName) { throw "EXE 작업 이름이 /WATCHDOGTASK와 다릅니다." }
    $report.checks.isolatedInstallDir = $true
    $report.checks.isolatedDataDir = $true

    $shortcuts = @(
        (Join-Path $desktopDir "GugakSignage.lnk"),
        (Join-Path $startMenuDir "GugakSignage.lnk")
    )
    foreach ($shortcutPath in $shortcuts) {
        if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw "바로가기가 없습니다: $shortcutPath" }
        if (-not (Test-ShortcutOwnedByInstall -ShortcutPath $shortcutPath -InstallDir $installDir)) { throw "바로가기 소유권 확인 실패: $shortcutPath" }
    }
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    if (@($task.Triggers).Count -ne 1 -or -not ([string]$task.Triggers[0].CimClass.CimClassName).Contains("LogonTrigger")) {
        throw "At log on 작업 트리거가 없습니다."
    }
    if (-not (Test-ScheduledTaskOwnedByInstall -Task $task -InstallDir $installDir)) { throw "작업 스케줄러 소유권 확인 실패." }
    $report.checks.desktopShortcut = $true
    $report.checks.startMenuShortcut = $true
    $report.checks.scheduledTaskAtLogOn = $true
    $report.checks.separateDataFolder = $true

    Wait-Until -TimeoutSeconds 90 -Description "EXE 설치 서버 health" -Condition { Test-ServerHealth -PortNumber $port }
    $statePath = Join-Path $dataDir "logs\watchdog-state.json"
    Wait-Until -TimeoutSeconds 30 -Description "EXE 설치 watchdog 상태" -Condition { Test-Path -LiteralPath $statePath }
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $debugPort = [int]$config.debugPort
    $innoPlayerJson = Join-Path $evidenceDir "player-inno-installed.json"
    $innoPlayerPng = Join-Path $evidenceDir "player-inno-installed.png"
    & $nodePath (Join-Path $PSScriptRoot "verify-browser.mjs") --debug-port $debugPort --expect online --screenshot $innoPlayerPng --output $innoPlayerJson | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "EXE 설치 재생기 확인 실패" }
    $report.checks.serverHealthy = $true
    $report.checks.playerRendering = $true
    $report.screenshots = @("docs/install/evidence/player-inno-installed.png")

    & (Join-Path $installDir "tools\set-autostart.ps1") -Disable | Out-Host
    Wait-Until -TimeoutSeconds 25 -Description "Inno 업그레이드 전 서비스 중지" -Condition { -not (Test-ServerHealth -PortNumber $port) }
    Wait-Until -TimeoutSeconds 25 -Description "Inno 업그레이드 전 프로세스 종료" -Condition {
        $currentState = Get-Content -LiteralPath (Join-Path $dataDir "logs\watchdog-state.json") -Raw | ConvertFrom-Json
        return (-not $currentState.serverPid -and -not $currentState.browserPid)
    }
    $databaseHashBeforeUpgrade = Get-StableFileHash -Path (Join-Path $dataDir "signage.sqlite")
    $upgradeArguments = '/CURRENTUSER /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOSTART=1 /DIR="' + $installDir + '" /WATCHDOGTASK="' + $taskName + '" /DESKTOPDIR="' + $desktopDir + '" /STARTMENUDIR="' + $startMenuDir + '" /PLAYERPROFILE="' + $profileDir + '" /LOG="' + $upgradeLog + '"'
    $upgrader = Start-Process -FilePath $SetupExe -ArgumentList $upgradeArguments -Wait -PassThru -WindowStyle Hidden
    if ($upgrader.ExitCode -ne 0) { throw "Inno Setup 업그레이드 실패: exit=$($upgrader.ExitCode), log=$upgradeLog" }
    $upgradedConfig = Get-Content -LiteralPath (Join-Path $installDir "install.json") -Raw | ConvertFrom-Json
    if (-not (Test-PathEqual -Left ([string]$upgradedConfig.dataDir) -Right $dataDir)) {
        throw "Inno 업그레이드가 기존 데이터 폴더를 보존하지 않았습니다."
    }
    $upgradedEnv = Get-Content -LiteralPath (Join-Path $dataDir ".env") -Raw
    if ($upgradedEnv -notmatch "(?m)^SEED_SAMPLES=false\s*$") { throw "Inno 업그레이드가 샘플 시드를 비활성화하지 않았습니다." }
    $databaseHashAfterUpgrade = Get-StableFileHash -Path (Join-Path $dataDir "signage.sqlite")
    if ($databaseHashBeforeUpgrade -ne $databaseHashAfterUpgrade) { throw "Inno 업그레이드가 기존 SQLite 파일을 변경했습니다." }
    Start-ScheduledTask -TaskName $taskName
    Wait-Until -TimeoutSeconds 90 -Description "Inno 업그레이드 후 서버 health" -Condition { Test-ServerHealth -PortNumber $port }
    $report.checks.innoUpgradePreservesDataDir = $true
    $report.checks.innoUpgradePreservesDatabase = $true
    $report.checks.innoUpgradeDisablesSeedSamples = $true

    $uninstaller = Join-Path $installDir "unins000.exe"
    if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Inno Setup 제거 관리자가 없습니다." }
    $uninstallArguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="' + $uninstallerLog + '"'
    $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList $uninstallArguments -Wait -PassThru -WindowStyle Hidden
    if ($uninstallProcess.ExitCode -ne 0) { throw "Inno Setup 제거 실패: exit=$($uninstallProcess.ExitCode)" }
    Wait-Until -TimeoutSeconds 60 -Description "Inno 기본 제거 완료" -Condition {
        return (-not (Test-Path -LiteralPath $installDir)) -and
            (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) -and
            (-not (Test-Path -LiteralPath $shortcuts[0])) -and
            (-not (Test-Path -LiteralPath $shortcuts[1]))
    }
    if (-not (Test-Path -LiteralPath (Join-Path $dataDir ".env"))) { throw "기본 제거가 .env 데이터를 삭제했습니다." }
    if (-not (Test-Path -LiteralPath (Join-Path $dataDir "signage.sqlite"))) { throw "기본 제거가 SQLite 데이터를 삭제했습니다." }
    $report.checks.uninstallRemovedApplication = $true
    $report.checks.uninstallRemovedShortcutsAndTask = $true
    $report.checks.uninstallPreservedData = $true
    $report.result = "passed"
} catch {
    $report.result = "failed"
    $report.error = $_.Exception.Message
    throw
} finally {
    $report.finishedAt = [DateTime]::UtcNow.ToString("o")
    $report.productionPathsAfter = Get-ProductionPathSnapshot
    $report.checks.productionPathsUntouched = (($report.productionPathsBefore | ConvertTo-Json -Compress) -eq
        ($report.productionPathsAfter | ConvertTo-Json -Compress))
    if ($report.result -ne "passed" -and (Test-Path -LiteralPath (Join-Path $installDir "tools\uninstall.ps1"))) {
        try { & (Join-Path $installDir "tools\uninstall.ps1") -KeepInstallFiles -Quiet | Out-Host } catch {
            Write-Warning "Inno 실패 정리 오류: $($_.Exception.Message)"
        }
    }
    $installLog = Get-ChildItem -LiteralPath (Join-Path $dataDir "logs") -Filter "install-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
    $uninstallLog = Get-ChildItem -LiteralPath (Join-Path $dataDir "logs") -Filter "uninstall-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
    if ($installLog) { Sanitize-File -Source $installLog.FullName -Destination (Join-Path $evidenceDir "inno-postinstall-run.txt") }
    if ($uninstallLog) { Sanitize-File -Source $uninstallLog.FullName -Destination (Join-Path $evidenceDir "inno-uninstallscript-run.txt") }
    Sanitize-InnoLog -Source $installerLog -Destination (Join-Path $evidenceDir "inno-setup-log.txt")
    Sanitize-InnoLog -Source $upgradeLog -Destination (Join-Path $evidenceDir "inno-upgrade-log.txt")
    Sanitize-InnoLog -Source $uninstallerLog -Destination (Join-Path $evidenceDir "inno-uninstall-log.txt")
    $report | ConvertTo-Json -Depth 6 -Compress | Set-Content -LiteralPath (Join-Path $evidenceDir "inno-install-verification.json") -Encoding utf8
    foreach ($jsonFile in Get-ChildItem -LiteralPath $evidenceDir -Filter "player-inno-*.json" -ErrorAction SilentlyContinue) {
        Sanitize-File -Source $jsonFile.FullName -Destination $jsonFile.FullName
    }

    if (-not $KeepTestArtifacts) {
        $tempBase = Get-NormalizedPath -Path ([IO.Path]::GetTempPath())
        $resolved = Get-NormalizedPath -Path $testRoot
        if ($resolved.StartsWith($tempBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
            ([IO.Path]::GetFileName($resolved).StartsWith("GugakSignage-inno-test-"))) {
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "Inno test artifacts: $testRoot"
    }
}
