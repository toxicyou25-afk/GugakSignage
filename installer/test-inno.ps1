# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$SetupExe = "",
    [switch]$KeepTestArtifacts,
    [string]$EvidenceDir = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
. (Join-Path $PSScriptRoot "ops\install-common.ps1")
$repoRoot = Get-NormalizedPath -Path (Join-Path $PSScriptRoot "..")
if (-not $EvidenceDir) { $EvidenceDir = Join-Path $repoRoot "docs\install\evidence" }
$evidenceDir = [IO.Path]::GetFullPath($EvidenceDir)
if (-not $SetupExe) { $SetupExe = Join-Path $PSScriptRoot "build\inno\GugakSignage-Setup-0.1.0.exe" }
$SetupExe = (Resolve-Path -LiteralPath $SetupExe).Path
if (-not (Test-Path -LiteralPath $SetupExe -PathType Leaf)) { throw "Inno Setup EXE가 없습니다: $SetupExe" }
$innoSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "GugakSignage.iss"))
if ($innoSource -notmatch 'SaveStringsToUTF8FileWithoutBOM\(SecretPath, PasswordLines, False\)' -or
    $innoSource -notmatch 'PasswordLines\[0\] := Password' -or
    $innoSource -notmatch '-AdminPasswordFile "' -or $innoSource -match '-AdminPassword "') {
    throw "Inno setup must transfer the Manager password through its temporary UTF-8 file, not a process argument."
}
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

function Test-OwnedProcess {
    param([int]$ProcessId)
    if (-not $ProcessId) { return $false }
    return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
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

function Get-DirectoryContentHash {
    param([Parameter(Mandatory = $true)][string]$Path)
    $rootPath = Get-NormalizedPath -Path $Path
    $entries = @()
    if (Test-Path -LiteralPath $rootPath -PathType Container) {
        foreach ($file in @(Get-ChildItem -LiteralPath $rootPath -File -Recurse | Sort-Object FullName)) {
            $relative = $file.FullName.Substring($rootPath.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
            $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            $entries += "$relative=$hash"
        }
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes(($entries -join "`n"))
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant() } finally { $sha.Dispose() }
}

function Get-DatabaseRowCounts {
    param([Parameter(Mandatory = $true)][string]$Path)
    $scriptPath = Join-Path ([IO.Path]::GetTempPath()) ("gugak-rowcount-" + [guid]::NewGuid().ToString("N") + ".cjs")
    $script = @'
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[2]);
const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
const counts = {};
for (const name of names) {
  const safeName = name.replaceAll('"', '""');
  counts[name] = db.prepare(`SELECT COUNT(*) AS count FROM "${safeName}"`).get().count;
}
console.log(JSON.stringify(counts));
db.close();
'@
    try {
        [IO.File]::WriteAllText($scriptPath, $script, [Text.UTF8Encoding]::new($false))
        $output = & $nodePath --no-warnings $scriptPath $Path 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
    }
    if ($exitCode -ne 0) { throw "SQLite row count 조회 실패: $($output -join ' ')" }
    $jsonLine = @($output | ForEach-Object { [string]$_ } | Where-Object { $_.TrimStart().StartsWith("{") } | Select-Object -Last 1)
    if ($jsonLine.Count -eq 0) { throw "SQLite row count JSON이 없습니다: $($output -join ' ')" }
    return ([string]$jsonLine[0]).Trim()
}

function Set-LegacyEnvDataDir {
    param([Parameter(Mandatory = $true)][string]$EnvFile, [Parameter(Mandatory = $true)][string]$DataDir)
    $envText = [IO.File]::ReadAllText($EnvFile)
    $escaped = $DataDir.Replace("\", "\\").Replace('"', '\"')
    $updated = [regex]::Replace($envText, "(?m)^DATA_DIR=.*$", ('DATA_DIR="' + $escaped + '"'))
    if ($updated -eq $envText) { throw "legacy fixture .env에 DATA_DIR가 없습니다." }
    [IO.File]::WriteAllText($EnvFile, $updated, [Text.UTF8Encoding]::new($false))
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
    $text = [regex]::Replace($text, 'http://127\.0\.0\.1:\d+', "<test-url>")
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
    $text = [regex]::Replace($text, 'http://127\.0\.0\.1:\d+', "<test-url>")
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
    $excerptText = [regex]::Replace(($excerpt -join [Environment]::NewLine), "[ \t]+\r?\n", [Environment]::NewLine).TrimEnd()
    Set-Content -LiteralPath $Destination -Value $excerptText -Encoding utf8
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
$hangulDataName = [string]::Concat([char]0xAE30, [char]0xAD00, " ", [char]0xB370, [char]0xC774, [char]0xD130)
$dataDir = Join-Path (Join-Path $testRoot $hangulDataName) "Gugak Signage"
$desktopDir = Join-Path $testRoot "desktop"
$startMenuDir = Join-Path $testRoot "start-menu"
$profileDir = Join-Path $testRoot "player-profile"
$taskName = "GugakSignage-InnoTest-$suffix"
$port = Get-FreePort
$installerLog = Join-Path $testRoot "inno-install.log"
$upgradeLog = Join-Path $testRoot "inno-legacy-upgrade.log"
$conflictLog = Join-Path $testRoot "inno-conflict.log"
$reupgradeLog = Join-Path $testRoot "inno-same-version-reupgrade.log"
$uninstallerLog = Join-Path $testRoot "inno-uninstall.log"
$configBeforeLegacy = ""
$productionLocalData = Join-Path $env:LOCALAPPDATA "GugakSignage"
$productionLocalItemBefore = Get-Item -LiteralPath $productionLocalData -ErrorAction SilentlyContinue
$productionLocalBefore = [ordered]@{
    exists = [bool]$productionLocalItemBefore
    lastWriteUtc = if ($productionLocalItemBefore) { $productionLocalItemBefore.LastWriteTimeUtc.ToString("o") } else { $null }
}
$originalLocalAppData = $env:LOCALAPPDATA
$startedAt = [DateTime]::UtcNow
$report = [ordered]@{
    startedAt = $startedAt.ToString("o")
    setupExeSize = (Get-Item -LiteralPath $SetupExe).Length
    setupExeSha256 = (Get-FileHash -LiteralPath $SetupExe -Algorithm SHA256).Hash.ToLowerInvariant()
    innoCompilerVersion = "6.7.3"
    port = $port
    taskName = $taskName
    result = "running"
    checks = [ordered]@{ evidenceUrlsSanitized = $true }
    productionPathsBefore = Get-ProductionPathSnapshot
    productionLocalDataBefore = $productionLocalBefore
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$isolatedLocalAppData = Join-Path $testRoot "isolated-localappdata"
New-Item -ItemType Directory -Path $isolatedLocalAppData -Force | Out-Null
$env:LOCALAPPDATA = $isolatedLocalAppData
try {
    $installArguments = '/CURRENTUSER /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /HEADLESS=1 /DIR="' + $installDir + '" /DATADIR="' + $dataDir + '" /PORT=' + $port + ' /WATCHDOGTASK="' + $taskName + '" /DESKTOPDIR="' + $desktopDir + '" /STARTMENUDIR="' + $startMenuDir + '" /PLAYERPROFILE="' + $profileDir + '" /LOG="' + $installerLog + '"'
    $installer = Start-Process -FilePath $SetupExe -ArgumentList $installArguments -Wait -PassThru -WindowStyle Hidden
    if ($installer.ExitCode -ne 0) { throw "Inno Setup 설치 실패: exit=$($installer.ExitCode), log=$installerLog" }
    Wait-Until -TimeoutSeconds 30 -Description "Inno 설치 파일" -Condition { Test-Path -LiteralPath (Join-Path $installDir "install.json") }
    $config = Read-JsonFile -Path (Join-Path $installDir "install.json")
    if ([string]$config.role -ne "integrated" -or [string]$config.setupRole -ne "all" -or [string]$config.mode -ne "standalone") {
        throw "기본 Inno 설치가 legacy integrated/standalone 역할 계약을 기록하지 않았습니다."
    }
    if (-not (Test-PathEqual -Left ([string]$config.installDir) -Right $installDir)) { throw "EXE 설치 경로가 격리 경로와 다릅니다." }
    if (-not (Test-PathEqual -Left ([string]$config.dataDir) -Right $dataDir)) { throw "EXE 데이터 경로가 /DATADIR와 다릅니다." }
    if ([string]$config.adminUrl -ne "http://127.0.0.1:$port/admin/") { throw "Integrated install did not retain the localhost HTTP admin URL." }
    if ([string]$config.taskName -ne $taskName) { throw "EXE 작업 이름이 /WATCHDOGTASK와 다릅니다." }
    $report.checks.isolatedInstallDir = $true
    $report.checks.isolatedDataDir = $true
    $report.checks.legacyIntegratedRole = $true
    $report.checks.headlessTestBrowser = [bool]$config.browserHeadless
    if (@($config.adminShortcuts).Count -ne 2) { throw "EXE 설치가 관리자 바로가기 두 개를 install.json에 기록하지 않았습니다." }
    if ($config.adminAutoOpen.enabled -ne $false) { throw "headless EXE 설치가 관리자 페이지 자동 열기를 끄지 않았습니다." }
    $report.checks.adminShortcutsRecorded = $true
    $report.checks.headlessDisablesAdminAutoOpen = $true

    $shortcuts = @(
        (Join-Path $desktopDir "열린안내판.lnk"),
        (Join-Path $startMenuDir "열린안내판.lnk")
    )
    foreach ($shortcutPath in $shortcuts) {
        if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw "바로가기가 없습니다: $shortcutPath" }
        if (-not (Test-ShortcutOwnedByInstall -ShortcutPath $shortcutPath -InstallDir $installDir)) { throw "바로가기 소유권 확인 실패: $shortcutPath" }
    }
    $adminShortcuts = @(
        (Join-Path $desktopDir "열린안내판 관리자.lnk"),
        (Join-Path $startMenuDir "열린안내판 관리자.lnk")
    )
    foreach ($shortcutPath in $adminShortcuts) {
        if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw "관리자 바로가기가 없습니다: $shortcutPath" }
        if (-not (Test-AdminShortcutOwnedByInstall -ShortcutPath $shortcutPath -InstallDir $installDir)) { throw "관리자 바로가기 소유권 확인 실패: $shortcutPath" }
        $adminShortcut = [pscustomobject]@{ IconLocation = [GugakShortcutNative]::GetIconLocation($shortcutPath) }
        if ($adminShortcut.IconLocation -notlike "*msedge.exe*" -and $adminShortcut.IconLocation -notlike "*chrome.exe*") {
            throw "관리자 바로가기 아이콘이 설치된 브라우저를 가리키지 않습니다: $($adminShortcut.IconLocation)"
        }
    }
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    if (@($task.Triggers).Count -ne 1 -or -not ([string]$task.Triggers[0].CimClass.CimClassName).Contains("LogonTrigger")) {
        throw "At log on 작업 트리거가 없습니다."
    }
    if (-not (Test-ScheduledTaskOwnedByInstall -Task $task -InstallDir $installDir)) { throw "작업 스케줄러 소유권 확인 실패." }
    $report.checks.desktopShortcut = $true
    $report.checks.startMenuShortcut = $true
    $report.checks.adminDesktopShortcut = $true
    $report.checks.adminStartMenuShortcut = $true
    $report.checks.adminShortcutIcon = $true
    $report.checks.scheduledTaskAtLogOn = $true
    $report.checks.separateDataFolder = $true

    Wait-Until -TimeoutSeconds 90 -Description "EXE 설치 서버 health" -Condition { Test-ServerHealth -PortNumber $port }
    $cookieContainer = [System.Net.CookieContainer]::new()
    $httpHandler = [System.Net.Http.HttpClientHandler]::new()
    $httpHandler.CookieContainer = $cookieContainer
    $adminApiClient = [System.Net.Http.HttpClient]::new($httpHandler)
    $loginContent = [System.Net.Http.StringContent]::new('{"password":"0000"}', [Text.Encoding]::UTF8, "application/json")
    $loginResponse = $adminApiClient.PostAsync("http://127.0.0.1:$port/api/auth/login", $loginContent).GetAwaiter().GetResult()
    if (-not $loginResponse.IsSuccessStatusCode) { throw "Inno 설치의 테스트 관리자 비밀번호 0000 로그인이 실패했습니다." }
    if ($cookieContainer.GetCookies([Uri]::new("http://127.0.0.1:$port/")).Count -lt 1) {
        throw "Inno 설치 관리자 세션 쿠키를 받지 못했습니다."
    }
    $report.checks.testAdminPasswordLogin = $true
    $statePath = Join-Path $dataDir "logs\watchdog-state.json"
    Wait-Until -TimeoutSeconds 30 -Description "EXE 설치 watchdog 상태" -Condition { Test-Path -LiteralPath $statePath }
    $state = Read-JsonFile -Path $statePath
    $initialPlayerState = Read-JsonFile -Path (Join-Path $dataDir "control\player-state.json")
    if ($state.browserPid -or $initialPlayerState.running -or $initialPlayerState.desired -ne "stopped") {
        throw "EXE 자동 실행이 관리자 요청 없이 재생기를 시작했습니다."
    }
    $report.checks.playerOffUntilRequested = $true
    $deviceList = ConvertFrom-Json ($adminApiClient.GetStringAsync("http://127.0.0.1:$port/api/devices").GetAwaiter().GetResult())
    $deviceId = [string](@($deviceList.devices)[0].id)
    $launchBody = @{ deviceId = $deviceId } | ConvertTo-Json -Compress
    $launchResponse = $adminApiClient.PostAsync("http://127.0.0.1:$port/api/player/launch", [System.Net.Http.StringContent]::new($launchBody, [Text.Encoding]::UTF8, "application/json")).GetAwaiter().GetResult()
    if ([int]$launchResponse.StatusCode -ne 202) { throw "EXE 재생기 실행 API가 실패했습니다: HTTP $([int]$launchResponse.StatusCode)" }
    Wait-Until -TimeoutSeconds 25 -Description "EXE 관리자 요청 재생기" -Condition {
        $current = Read-JsonFile -Path $statePath
        return [bool]($current.browserPid -and (Test-OwnedProcess -ProcessId ([int]$current.browserPid)))
    }
    $report.checks.playerLaunchedFromAdminApi = $true
    $debugPort = [int]$config.debugPort
    $innoPlayerJson = Join-Path $evidenceDir "player-inno-installed.json"
    $innoPlayerPng = Join-Path $evidenceDir "player-inno-installed.png"
    & $nodePath (Join-Path $PSScriptRoot "verify-browser.mjs") --debug-port $debugPort --expect online --screenshot $innoPlayerPng --output $innoPlayerJson | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "EXE 설치 재생기 확인 실패" }
    $report.checks.serverHealthy = $true
    $report.checks.playerRendering = $true
    $report.screenshots = @("docs/install/evidence/player-inno-installed.png")

    $explicitDataDir = Join-Path $testRoot "explicit-data-change"
    $changeLog = Join-Path $testRoot "inno-explicit-data-change.log"
    $configHashBeforeChange = Get-StableFileHash -Path (Join-Path $installDir "install.json")
    $sentinelPath = Join-Path $installDir "package.json"
    $sentinelBefore = [IO.File]::ReadAllBytes($sentinelPath)
    [IO.File]::WriteAllText($sentinelPath, "installer-sentinel-content", [Text.UTF8Encoding]::new($false))
    $sentinelHash = Get-StableFileHash -Path $sentinelPath
    $changeArguments = '/CURRENTUSER /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOSTART=1 /HEADLESS=1 /DIR="' + $installDir + '" /DATADIR="' + $explicitDataDir + '" /WATCHDOGTASK="' + $taskName + '" /DESKTOPDIR="' + $desktopDir + '" /STARTMENUDIR="' + $startMenuDir + '" /PLAYERPROFILE="' + $profileDir + '" /LOG="' + $changeLog + '"'
    try {
        $changeRun = Start-Process -FilePath $SetupExe -ArgumentList $changeArguments -Wait -PassThru -WindowStyle Hidden
        if ($changeRun.ExitCode -eq 0) { throw "기존 설치의 /DATADIR 변경이 Setup 성공으로 종료됐습니다." }
        if ((Get-StableFileHash -Path (Join-Path $installDir "install.json")) -ne $configHashBeforeChange) { throw "거부된 /DATADIR 변경이 install.json을 변경했습니다." }
        if (Test-Path -LiteralPath $explicitDataDir) { throw "거부된 /DATADIR 변경이 새 데이터 폴더를 만들었습니다." }
        if ((Get-StableFileHash -Path $sentinelPath) -ne $sentinelHash) { throw "거부된 /DATADIR 변경이 앱 파일을 덮어썼습니다." }
        $report.checks.existingDataDirChangeRejected = $true
        $report.checks.existingDataDirChangePreservesAppFiles = $true
    } finally {
        [IO.File]::WriteAllBytes($sentinelPath, $sentinelBefore)
    }

    & (Join-Path $installDir "tools\set-autostart.ps1") -Disable | Out-Host
    Wait-Until -TimeoutSeconds 25 -Description "Inno 업그레이드 전 서비스 중지" -Condition { -not (Test-ServerHealth -PortNumber $port) }
    Wait-Until -TimeoutSeconds 25 -Description "Inno 업그레이드 전 프로세스 종료" -Condition {
        $currentState = Read-JsonFile -Path (Join-Path $dataDir "logs\watchdog-state.json")
        return (-not $currentState.serverPid -and -not $currentState.browserPid)
    }
    $dataEnvPath = Join-Path $dataDir ".env"
    $legacyEnvPath = Join-Path $installDir ".env"
    $uploadsDir = Join-Path $dataDir "uploads"
    $uploadMarker = Join-Path $uploadsDir "legacy-preservation-marker.txt"
    New-Item -ItemType Directory -Path $uploadsDir -Force | Out-Null
    [IO.File]::WriteAllText($uploadMarker, "legacy upload fixture")
    Set-LegacyEnvDataDir -EnvFile $dataEnvPath -DataDir $dataDir
    Move-Item -LiteralPath $dataEnvPath -Destination $legacyEnvPath
    $legacyEnvAclSddl = (Get-Acl -LiteralPath $legacyEnvPath).Sddl
    $legacyEnvBytesBefore = [IO.File]::ReadAllBytes($legacyEnvPath)
    $legacyEnvBefore = [IO.File]::ReadAllText($legacyEnvPath)
    $legacyEnvHashBefore = Get-StableFileHash -Path $legacyEnvPath
    $appSentinel = Join-Path $installDir "package.json"
    $appSentinelHashBefore = Get-StableFileHash -Path $appSentinel
    $configBeforeLegacy = [IO.File]::ReadAllText((Join-Path $installDir "install.json"))
    Remove-Item -LiteralPath (Join-Path $installDir "install.json") -Force
    if (Test-Path -LiteralPath $dataEnvPath) { throw "legacy fixture에 데이터 폴더 .env가 남아 있습니다." }
    $databasePath = Join-Path $dataDir "signage.sqlite"
    $databaseRowsBeforeUpgrade = Get-DatabaseRowCounts -Path $databasePath
    $uploadsHashBeforeUpgrade = Get-DirectoryContentHash -Path $uploadsDir

    $upgradeArguments = '/CURRENTUSER /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOSTART=1 /HEADLESS=1 /DIR="' + $installDir + '" /WATCHDOGTASK="' + $taskName + '" /DESKTOPDIR="' + $desktopDir + '" /STARTMENUDIR="' + $startMenuDir + '" /PLAYERPROFILE="' + $profileDir + '" /LOG="' + $upgradeLog + '"'
    $upgrader = Start-Process -FilePath $SetupExe -ArgumentList $upgradeArguments -Wait -PassThru -WindowStyle Hidden
    if ($upgrader.ExitCode -ne 0) { throw "install.json 없는 legacy Inno 업그레이드 실패: exit=$($upgrader.ExitCode), log=$upgradeLog" }
    Wait-Until -TimeoutSeconds 30 -Description "legacy 업그레이드 install.json" -Condition { Test-Path -LiteralPath (Join-Path $installDir "install.json") }
    $upgradedConfig = Read-JsonFile -Path (Join-Path $installDir "install.json")
    if (-not (Test-PathEqual -Left ([string]$upgradedConfig.dataDir) -Right $dataDir)) {
        throw "install.json 없는 legacy 업그레이드가 .env의 사용자 지정 경로를 보존하지 않았습니다."
    }
    if (-not (Test-PathEqual -Left ([string]$upgradedConfig.envFile) -Right $dataEnvPath)) { throw "legacy .env를 데이터 폴더로 이전하지 않았습니다." }
    if (-not (Test-PathEqual -Left (Get-EnvValue -EnvFile $legacyEnvPath -Name "DATA_DIR") -Right $dataDir)) { throw "escaped .env DATA_DIR를 복원하지 못했습니다." }
    if ((Get-EnvValue -EnvFile $dataEnvPath -Name "ADMIN_PASSWORD") -ne "0000") { throw "legacy 관리자 비밀번호 0000을 보존하지 않았습니다." }
    if ((Get-EnvValue -EnvFile $dataEnvPath -Name "SEED_SAMPLES") -ne "true") { throw "legacy 업그레이드가 .env의 SEED_SAMPLES 값을 변경했습니다." }
    if (-not [Linq.Enumerable]::SequenceEqual([byte[]]$legacyEnvBytesBefore, [byte[]][IO.File]::ReadAllBytes($dataEnvPath))) {
        throw "legacy 업그레이드가 복사한 .env 바이트를 변경했습니다."
    }
    if ((Get-Acl -LiteralPath $dataEnvPath).Sddl -ne $legacyEnvAclSddl) { throw "legacy .env ACL을 보존하지 않았습니다." }
    if ((Get-StableFileHash -Path $legacyEnvPath) -ne $legacyEnvHashBefore) { throw "legacy 설치 폴더의 원본 .env를 변경했습니다." }
    if ((Get-DatabaseRowCounts -Path $databasePath) -ne $databaseRowsBeforeUpgrade) { throw "legacy 업그레이드가 기존 SQLite 행 수를 변경했습니다." }
    if ((Get-DirectoryContentHash -Path $uploadsDir) -ne $uploadsHashBeforeUpgrade) { throw "legacy 업그레이드가 기존 uploads를 변경했습니다." }
    if ((Get-StableFileHash -Path $appSentinel) -ne $appSentinelHashBefore) { throw "legacy 업그레이드 전 app sentinel이 예상치 않게 달라졌습니다." }
    $report.checks.innoLegacyNoManifestUsesEnvDataDir = $true
    $report.checks.innoLegacyEscapedUnicodePath = $true
    $report.checks.innoLegacyCopiesEnvAndPreservesAcl = $true
    $report.checks.innoLegacyPreservesAdminPassword0000 = $true
    $report.checks.innoLegacyPreservesEnvBytesAndAcl = $true
    $report.checks.innoLegacyPreservesDatabaseHashAndRows = $true
    $report.checks.innoLegacyPreservesUploads = $true
    $report.checks.innoLegacySourceEnvUnchanged = $true

    $conflictDataDir = Join-Path $testRoot "conflicting-data"
    New-Item -ItemType Directory -Path (Join-Path $conflictDataDir "uploads") -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $conflictDataDir "signage.sqlite"), "conflicting legacy fixture")
    Set-LegacyEnvDataDir -EnvFile $legacyEnvPath -DataDir $conflictDataDir
    $conflictingEnvHash = Get-StableFileHash -Path $legacyEnvPath
    $configHashBeforeConflict = Get-StableFileHash -Path (Join-Path $installDir "install.json")
    $uploadsHashBeforeConflict = Get-DirectoryContentHash -Path $uploadsDir
    $conflictArguments = '/CURRENTUSER /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOSTART=1 /HEADLESS=1 /DIR="' + $installDir + '" /WATCHDOGTASK="' + $taskName + '" /DESKTOPDIR="' + $desktopDir + '" /STARTMENUDIR="' + $startMenuDir + '" /PLAYERPROFILE="' + $profileDir + '" /LOG="' + $conflictLog + '"'
    $conflictRun = Start-Process -FilePath $SetupExe -ArgumentList $conflictArguments -Wait -PassThru -WindowStyle Hidden
    if ($conflictRun.ExitCode -eq 0) { throw "서로 다른 install.json/.env 데이터 경로의 Inno 업그레이드가 허용되었습니다." }
    if ((Get-StableFileHash -Path (Join-Path $installDir "install.json")) -ne $configHashBeforeConflict -or
        (Get-StableFileHash -Path $legacyEnvPath) -ne $conflictingEnvHash -or
        (Get-DirectoryContentHash -Path $uploadsDir) -ne $uploadsHashBeforeConflict -or
        (Get-StableFileHash -Path $appSentinel) -ne $appSentinelHashBefore) {
        throw "경로 충돌로 중단된 업그레이드가 기존 설치 또는 데이터를 변경했습니다."
    }
    $report.checks.conflictingPathsFailClosedWithoutMutation = $true

    $reverseRoot = Join-Path $testRoot "reverse-nesting"
    $reverseApp = Join-Path $reverseRoot "app"
    $reverseLog = Join-Path $testRoot "inno-reverse-nesting.log"
    $reverseArguments = '/CURRENTUSER /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOSTART=1 /HEADLESS=1 /DIR="' + $reverseApp + '" /DATADIR="' + $reverseRoot + '" /PORT=' + $port + ' /WATCHDOGTASK="' + $taskName + '-reverse" /DESKTOPDIR="' + $desktopDir + '" /STARTMENUDIR="' + $startMenuDir + '" /PLAYERPROFILE="' + $profileDir + '" /LOG="' + $reverseLog + '"'
    $reverseRun = Start-Process -FilePath $SetupExe -ArgumentList $reverseArguments -Wait -PassThru -WindowStyle Hidden
    if ($reverseRun.ExitCode -eq 0) { throw "reverse-nesting Inno 설치가 성공으로 종료됐습니다." }
    if (Test-Path -LiteralPath $reverseApp) {
        $reverseFiles = @(Get-ChildItem -LiteralPath $reverseApp -Recurse -File -ErrorAction SilentlyContinue)
        if ($reverseFiles.Count -gt 0) { throw "reverse-nesting 실패 후 앱 파일이 남았습니다: $($reverseFiles.Count)개" }
    }
    if (Test-Path -LiteralPath (Join-Path $reverseApp "install.json")) { throw "reverse-nesting 실패 후 install.json이 남았습니다." }
    $report.checks.reverseNestingAbortedBeforeFiles = $true
    [IO.File]::WriteAllText($legacyEnvPath, $legacyEnvBefore, [Text.UTF8Encoding]::new($false))

    & (Join-Path $installDir "tools\set-autostart.ps1") -Disable | Out-Host
    Wait-Until -TimeoutSeconds 25 -Description "same-version 재업그레이드 전 서비스 중지" -Condition { -not (Test-ServerHealth -PortNumber $port) }
    Wait-Until -TimeoutSeconds 25 -Description "same-version 재업그레이드 전 프로세스 종료" -Condition {
        $currentState = Read-JsonFile -Path (Join-Path $dataDir "logs\watchdog-state.json")
        return (-not $currentState.serverPid -and -not $currentState.browserPid)
    }
    $uploadsHashBeforeReupgrade = Get-DirectoryContentHash -Path $uploadsDir
    $envHashBeforeReupgrade = Get-StableFileHash -Path $dataEnvPath
    $envAclBeforeReupgrade = (Get-Acl -LiteralPath $dataEnvPath).Sddl
    $reupgradeArguments = '/CURRENTUSER /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOSTART=1 /HEADLESS=1 /DIR="' + $installDir + '" /WATCHDOGTASK="' + $taskName + '" /DESKTOPDIR="' + $desktopDir + '" /STARTMENUDIR="' + $startMenuDir + '" /PLAYERPROFILE="' + $profileDir + '" /LOG="' + $reupgradeLog + '"'
    $reupgrader = Start-Process -FilePath $SetupExe -ArgumentList $reupgradeArguments -Wait -PassThru -WindowStyle Hidden
    if ($reupgrader.ExitCode -ne 0) { throw "same-version Inno 재업그레이드 실패: exit=$($reupgrader.ExitCode), log=$reupgradeLog" }
    $reupgradedConfig = Read-JsonFile -Path (Join-Path $installDir "install.json")
    if (-not (Test-PathEqual -Left ([string]$reupgradedConfig.dataDir) -Right $dataDir)) { throw "same-version 재업그레이드가 데이터 경로를 변경했습니다." }
    if ((Get-DirectoryContentHash -Path $uploadsDir) -ne $uploadsHashBeforeReupgrade) {
        throw "same-version 재업그레이드가 기존 데이터를 변경했습니다."
    }
    if ((Get-StableFileHash -Path $dataEnvPath) -ne $envHashBeforeReupgrade -or
        (Get-Acl -LiteralPath $dataEnvPath).Sddl -ne $envAclBeforeReupgrade) {
        throw "same-version 재업그레이드가 기존 .env 바이트 또는 ACL을 변경했습니다."
    }
    $report.checks.sameVersionReupgradePreservesLegacyData = $true

    Start-ScheduledTask -TaskName $taskName
    Wait-Until -TimeoutSeconds 90 -Description "legacy 업그레이드 후 서버 health" -Condition { Test-ServerHealth -PortNumber $port }
    $loginClient = [System.Net.Http.HttpClient]::new()
    try {
        $loginContent = [System.Net.Http.StringContent]::new('{"password":"0000"}', [Text.Encoding]::UTF8, "application/json")
        $loginResponse = $loginClient.PostAsync("http://127.0.0.1:$port/api/auth/login", $loginContent).GetAwaiter().GetResult()
        if (-not $loginResponse.IsSuccessStatusCode) { throw "legacy 업그레이드 후 0000 로그인이 실패했습니다." }
    } finally {
        $loginClient.Dispose()
    }
    $report.checks.innoLegacyAdminPasswordLogin = $true

    $uninstaller = Join-Path $installDir "unins000.exe"
    if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Inno Setup 제거 관리자가 없습니다." }
    $databaseRowsBeforeUninstall = Get-DatabaseRowCounts -Path $databasePath
    $uploadsHashBeforeUninstall = Get-DirectoryContentHash -Path $uploadsDir
    $envHashBeforeUninstall = Get-StableFileHash -Path $dataEnvPath
    $uninstallArguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="' + $uninstallerLog + '"'
    $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList $uninstallArguments -Wait -PassThru -WindowStyle Hidden
    if ($uninstallProcess.ExitCode -ne 0) { throw "Inno Setup 제거 실패: exit=$($uninstallProcess.ExitCode)" }
    Wait-Until -TimeoutSeconds 60 -Description "Inno 기본 제거 완료" -Condition {
        $remainingShortcuts = @(@($shortcuts) + @($adminShortcuts) | Where-Object { Test-Path -LiteralPath $_ })
        return (-not (Test-Path -LiteralPath $installDir)) -and
            (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) -and
            $remainingShortcuts.Count -eq 0
    }
    if (-not (Test-Path -LiteralPath (Join-Path $dataDir ".env"))) { throw "기본 제거가 .env 데이터를 삭제했습니다." }
    if (-not (Test-Path -LiteralPath (Join-Path $dataDir "signage.sqlite"))) { throw "기본 제거가 SQLite 데이터를 삭제했습니다." }
    if ((Get-DatabaseRowCounts -Path $databasePath) -ne $databaseRowsBeforeUninstall -or
        (Get-DirectoryContentHash -Path $uploadsDir) -ne $uploadsHashBeforeUninstall -or
        (Get-StableFileHash -Path $dataEnvPath) -ne $envHashBeforeUninstall -or
        -not (Test-Path -LiteralPath $uploadMarker -PathType Leaf)) {
        throw "기본 제거가 legacy 데이터 내용을 변경했습니다."
    }
    $report.checks.uninstallRemovedApplication = $true
    $report.checks.uninstallRemovedShortcutsAndTask = $true
    $report.checks.uninstallPreservedData = $true
    $report.checks.uninstallPreservedDatabaseRowsUploadsAndEnv = $true
    $report.result = "passed"
} catch {
    $report.result = "failed"
    $report.error = $_.Exception.Message
    throw
} finally {
    $env:LOCALAPPDATA = $originalLocalAppData
    $report.finishedAt = [DateTime]::UtcNow.ToString("o")
    $report.productionPathsAfter = Get-ProductionPathSnapshot
    $report.checks.productionPathsUntouched = (($report.productionPathsBefore | ConvertTo-Json -Compress) -eq
        ($report.productionPathsAfter | ConvertTo-Json -Compress))
    $productionLocalItemAfter = Get-Item -LiteralPath $productionLocalData -ErrorAction SilentlyContinue
    $productionLocalAfter = [ordered]@{
        exists = [bool]$productionLocalItemAfter
        lastWriteUtc = if ($productionLocalItemAfter) { $productionLocalItemAfter.LastWriteTimeUtc.ToString("o") } else { $null }
    }
    $report.productionLocalDataAfter = $productionLocalAfter
    $report.checks.productionLocalDataUntouched = (($productionLocalBefore | ConvertTo-Json -Compress) -eq
        ($productionLocalAfter | ConvertTo-Json -Compress))
    if ($report.result -ne "passed" -and (Test-Path -LiteralPath (Join-Path $installDir "tools\uninstall.ps1"))) {
        if ($configBeforeLegacy -and -not (Test-Path -LiteralPath (Join-Path $installDir "install.json"))) {
            [IO.File]::WriteAllText((Join-Path $installDir "install.json"), $configBeforeLegacy, [Text.UTF8Encoding]::new($false))
        }
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
    Sanitize-InnoLog -Source $conflictLog -Destination (Join-Path $evidenceDir "inno-conflict-log.txt")
    Sanitize-InnoLog -Source $reupgradeLog -Destination (Join-Path $evidenceDir "inno-same-version-reupgrade-log.txt")
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
