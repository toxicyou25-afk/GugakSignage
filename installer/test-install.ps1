# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [switch]$KeepTestArtifacts,
    [string]$EvidenceDir = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
. (Join-Path $PSScriptRoot "ops\install-common.ps1")
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$installScript = Join-Path $PSScriptRoot "install.ps1"
$verifyScript = Join-Path $PSScriptRoot "verify-browser.mjs"
$guardScript = Join-Path $PSScriptRoot "test-guards.ps1"
$watchdogTestScript = Join-Path $PSScriptRoot "test-watchdog.mjs"
$watchdogHealthTest = Join-Path $PSScriptRoot "test-watchdog-health.mjs"
$evidenceDir = if ($EvidenceDir) { [IO.Path]::GetFullPath($EvidenceDir) } else { Join-Path $repoRoot "docs\install\evidence" }
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null

function Get-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Wait-Until {
    param(
        [scriptblock]$Condition,
        [int]$TimeoutSeconds,
        [string]$Description
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            if (& $Condition) { return $true }
        } catch {
        }
        Start-Sleep -Milliseconds 400
    }
    throw "시간 초과: $Description"
}

function Read-WatchdogState {
    param([string]$StatePath)
    return Read-JsonFile -Path $StatePath
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
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    return [bool]$process
}

function Invoke-AdminPlayerControl {
    param(
        [Parameter(Mandatory = $true)][System.Net.Http.HttpClient]$Client,
        [Parameter(Mandatory = $true)][int]$PortNumber,
        [Parameter(Mandatory = $true)][ValidateSet("launch", "stop")][string]$Action,
        [string]$DeviceId = ""
    )
    $payload = if ($Action -eq "launch") { @{ deviceId = $DeviceId } | ConvertTo-Json -Compress } else { "{}" }
    $content = [System.Net.Http.StringContent]::new($payload, [Text.Encoding]::UTF8, "application/json")
    $response = $Client.PostAsync("http://127.0.0.1:$PortNumber/api/player/$Action", $content).GetAwaiter().GetResult()
    if ([int]$response.StatusCode -ne 202) {
        throw "재생기 $Action API가 실패했습니다: HTTP $([int]$response.StatusCode)"
    }
}

function Invoke-PlayerCheck {
    param(
        [string]$Expect,
        [string]$Screenshot,
        [string]$Output
    )
    $arguments = @(
        $verifyScript,
        "--debug-port", [string]$debugPort,
        "--expect", $Expect,
        "--timeout-ms", "45000",
        "--output", $Output
    )
    if ($Screenshot) { $arguments += @("--screenshot", $Screenshot) }
    & $nodePath @arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "재생기 확인 실패: $Expect" }
    return Read-JsonFile -Path $Output
}

function Sanitize-Evidence {
    param(
        [string]$Source,
        [string]$Destination
    )
    if (-not (Test-Path -LiteralPath $Source)) { return }
    $text = Get-Content -LiteralPath $Source -Raw
    $testRootVariants = @($testRoot, $testRoot.Replace("\", "\\"), $testRoot.Replace("\", "/"))
    $repoRootVariants = @($repoRoot, $repoRoot.Replace("\", "\\"), $repoRoot.Replace("\", "/"))
    $homeVariants = @($env:USERPROFILE, $env:USERPROFILE.Replace("\", "\\"), $env:USERPROFILE.Replace("\", "/"))
    $replacements = @(
        @("$env:USERDOMAIN\$env:USERNAME", "<user>"),
        @($env:USERNAME, "<user>"),
        @($env:COMPUTERNAME, "<computer>")
    )
    foreach ($variant in $testRootVariants) { $text = $text.Replace([string]$variant, "<test-root>") }
    foreach ($variant in $repoRootVariants) { $text = $text.Replace([string]$variant, "<repo>") }
    foreach ($variant in $homeVariants) { $text = $text.Replace([string]$variant, "<home>") }
    foreach ($pair in $replacements) {
        if ($pair[0]) { $text = $text.Replace([string]$pair[0], [string]$pair[1]) }
    }
    $text = [regex]::Replace($text, 'http://127\.0\.0\.1:\d+', "<test-url>")
    $text = [regex]::Replace($text, "[ \t]+\r?\n", [Environment]::NewLine).TrimEnd()
    Set-Content -LiteralPath $Destination -Value $text -Encoding utf8
}

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "dist\server.js"))) {
    throw "dist\server.js가 없습니다. 먼저 npm run build를 실행하세요."
}
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "node_modules"))) {
    throw "node_modules가 없습니다. 먼저 npm ci를 실행하세요."
}
$nodePath = (Get-Command "node.exe").Source
$stamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
$suffix = [Guid]::NewGuid().ToString("N").Substring(0, 8)
$taskName = "GugakSignage-Test-$suffix"
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "GugakSignage-install-test-$stamp-$suffix"
$installDir = Join-Path $testRoot "app"
$dataDir = Join-Path $testRoot "data"
$desktopDir = Join-Path $testRoot "desktop"
$startMenuDir = Join-Path $testRoot "start-menu"
$profileDir = Join-Path $testRoot "browser-profile"
$rawLog = Join-Path $testRoot "test-transcript.log"
$port = Get-FreePort
$debugPort = Get-FreePort
$statePath = Join-Path $dataDir "logs\watchdog-state.json"
$report = [ordered]@{
    startedAt = [DateTime]::UtcNow.ToString("o")
    baseSha = (& git -C $repoRoot rev-parse HEAD).Trim()
    nodeVersion = (& $nodePath --version).Trim()
    port = $port
    debugPort = $debugPort
    taskName = $taskName
    result = "running"
    checks = [ordered]@{}
    screenshots = @()
    notRun = @(
        "실제 현장 물리 장비",
        "실제 Windows 재부팅 및 자동 로그인",
        "24시간 연속 운영",
        "방화벽 규칙 생성(권한/시스템 변경을 피하기 위해 선택 옵션 미실행)",
        "프로세스는 살아 있으나 CDP가 멈춘 실제 renderer hang 재현"
    )
}
$uninstallCompleted = $false
$transcriptStarted = $false

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
Start-Transcript -LiteralPath $rawLog -Append | Out-Null
$transcriptStarted = $true

try {
    Write-Host "[install-test] 경로·소유권 안전 가드 회귀 시험"
    $guardStdoutPath = Join-Path $testRoot "guard-output.txt"
    $guardStderrPath = Join-Path $testRoot "guard-error.txt"
    $guardArguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $guardScript
    $guardProcess = Start-Process -FilePath (Join-Path $PSHOME "powershell.exe") -ArgumentList $guardArguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput $guardStdoutPath -RedirectStandardError $guardStderrPath
    $guardOutput = @()
    if (Test-Path -LiteralPath $guardStdoutPath) { $guardOutput += Get-Content -LiteralPath $guardStdoutPath }
    if (Test-Path -LiteralPath $guardStderrPath) { $guardOutput += Get-Content -LiteralPath $guardStderrPath }
    $guardOutput | Out-Host
    if ($guardProcess.ExitCode -ne 0) { throw "경로·소유권 안전 가드 시험이 실패했습니다 (exit $($guardProcess.ExitCode)): $($guardOutput -join [Environment]::NewLine)" }
    $guardJson = @(Get-Content -LiteralPath $guardStdoutPath | Where-Object { ([string]$_).TrimStart().StartsWith("{") }) | Select-Object -Last 1
    if (-not $guardJson) { throw "안전 가드 시험 결과 JSON이 없습니다." }
    $report.checks.guardTests = $guardJson | ConvertFrom-Json

    Write-Host "[install-test] watchdog 건강 판정·영구 중단 회귀 시험"
    $healthOutput = & $nodePath --test $watchdogHealthTest 2>&1 | Tee-Object -Variable healthLines
    $healthLines | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "watchdog 건강 판정 시험이 실패했습니다." }
    $report.checks.watchdogHealthClassificationTests = $true
    $watchdogOutput = & $nodePath $watchdogTestScript 2>&1 | Tee-Object -Variable watchdogLines
    $watchdogLines | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "watchdog 영구 중단·로그 회전 시험이 실패했습니다." }
    $watchdogJson = @($watchdogOutput | Where-Object { ([string]$_).TrimStart().StartsWith("{") }) | Select-Object -Last 1
    if (-not $watchdogJson) { throw "watchdog 중단 시험 결과 JSON이 없습니다." }
    $report.checks.watchdogFailureLifecycle = $watchdogJson | ConvertFrom-Json

    Write-Host "[install-test] install.json 없는 PowerShell legacy 업그레이드"
    $hangulDataName = [string]::Concat([char]0xAE30, [char]0xAD00, " ", [char]0xB370, [char]0xC774, [char]0xD130)
    $legacyPsRoot = Join-Path $testRoot "legacy-powershell"
    $legacyPsApp = Join-Path $legacyPsRoot "app"
    $legacyPsData = Join-Path (Join-Path $legacyPsRoot $hangulDataName) "Gugak Signage"
    $legacyPsUploads = Join-Path $legacyPsData "uploads"
    $legacyPsDb = Join-Path $legacyPsData "signage.sqlite"
    $legacyPsEnv = Join-Path $legacyPsApp ".env"
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $currentPrincipal = [Security.Principal.WindowsPrincipal]::new($currentIdentity)
    $isCurrentAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $legacyPsDefault = if ($isCurrentAdmin) { Join-Path $env:ProgramData "GugakSignage" } else { Join-Path $env:LOCALAPPDATA "GugakSignage" }
    $legacyPsDefaultExisted = Test-Path -LiteralPath $legacyPsDefault
    New-Item -ItemType Directory -Path (Join-Path $legacyPsApp "ops"), $legacyPsUploads -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $legacyPsApp "ops\watchdog.mjs") -Value "// legacy fixture" -Encoding ascii
    [IO.File]::WriteAllText($legacyPsDb, "legacy-db-marker")
    $legacyPsUpload = Join-Path $legacyPsUploads "preserve-me.txt"
    [IO.File]::WriteAllText($legacyPsUpload, "legacy upload marker")
    $escapedLegacyPsData = $legacyPsData.Replace("\", "\\")
    $legacyPsEnvBuilder = [Text.StringBuilder]::new()
    [void]$legacyPsEnvBuilder.AppendLine("ADMIN_PASSWORD=0000")
    [void]$legacyPsEnvBuilder.AppendLine("SESSION_SECRET=legacy-session-secret-preserve-this-value")
    [void]$legacyPsEnvBuilder.AppendLine("PORT=3000")
    [void]$legacyPsEnvBuilder.Append('DATA_DIR="').Append($escapedLegacyPsData).AppendLine('"')
    [void]$legacyPsEnvBuilder.AppendLine("SEED_SAMPLES=true")
    [IO.File]::WriteAllText($legacyPsEnv, $legacyPsEnvBuilder.ToString(), [Text.UTF8Encoding]::new($false))
    $legacyPsEnvBytesBefore = [IO.File]::ReadAllBytes($legacyPsEnv)
    $legacyPsEnvAclSddl = (Get-Acl -LiteralPath $legacyPsEnv).Sddl
    $legacyPsEnvHashBefore = (Get-FileHash -LiteralPath $legacyPsEnv -Algorithm SHA256).Hash
    $legacyPsDbHashBefore = (Get-FileHash -LiteralPath $legacyPsDb -Algorithm SHA256).Hash
    $legacyPsUploadHashBefore = (Get-FileHash -LiteralPath $legacyPsUpload -Algorithm SHA256).Hash
    $legacyPsDataEnv = Join-Path $legacyPsData ".env"
    [IO.File]::WriteAllText($legacyPsDataEnv, $legacyPsEnvBuilder.ToString(), [Text.UTF8Encoding]::new($false))
    $legacyPsDataEnvBytesBefore = [IO.File]::ReadAllBytes($legacyPsDataEnv)
    $legacyPsDataEnvHashBefore = (Get-FileHash -LiteralPath $legacyPsDataEnv -Algorithm SHA256).Hash
    $legacyPsDataEnvAclBefore = (Get-Acl -LiteralPath $legacyPsDataEnv).Sddl
    $legacyPsTask = "GugakSignage-LegacyPowerShell-$suffix"
    $legacyPsDesktop = Join-Path $legacyPsRoot "desktop"
    $legacyPsStartMenu = Join-Path $legacyPsRoot "start-menu"
    $legacyPsProfile = Join-Path $legacyPsRoot "profile"
    & $installScript -SourceDir $repoRoot -InstallDir $legacyPsApp -DataDir $legacyPsData -TaskName $legacyPsTask -DesktopDir $legacyPsDesktop -StartMenuDir $legacyPsStartMenu -ProfileDir $legacyPsProfile -ConfigureOnly -NoStart -NoAutoStart 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "기존 데이터 .env 업그레이드가 실패했습니다." }
    if (-not [Linq.Enumerable]::SequenceEqual([byte[]]$legacyPsDataEnvBytesBefore, [byte[]][IO.File]::ReadAllBytes($legacyPsDataEnv))) {
        throw "업그레이드가 기존 .env 바이트를 변경했습니다."
    }
    if ((Get-Acl -LiteralPath $legacyPsDataEnv).Sddl -ne $legacyPsDataEnvAclBefore) {
        throw "업그레이드가 기존 .env ACL을 변경했습니다."
    }
    if ((Get-FileHash -LiteralPath $legacyPsDataEnv -Algorithm SHA256).Hash -ne $legacyPsDataEnvHashBefore) {
        throw "업그레이드가 기존 .env SHA-256을 변경했습니다."
    }
    $report.checks.existingEnvBytesAndAclPreserved = $true
    Remove-Item -LiteralPath (Join-Path $legacyPsApp "install.json") -Force
    Remove-Item -LiteralPath $legacyPsDataEnv -Force

    $legacyPsPort = Get-FreePort
    $legacyPsOutput = & $installScript -SourceDir $repoRoot -InstallDir $legacyPsApp -Port $legacyPsPort -TaskName $legacyPsTask -DesktopDir $legacyPsDesktop -StartMenuDir $legacyPsStartMenu -ProfileDir $legacyPsProfile -ConfigureOnly -NoStart -NoAutoStart 2>&1 | Tee-Object -Variable legacyPsLines
    $legacyPsLines | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "PowerShell legacy 업그레이드가 실패했습니다." }
    $legacyPsConfig = Read-JsonFile -Path (Join-Path $legacyPsApp "install.json")
    $legacyPsDataEnvText = [IO.File]::ReadAllText($legacyPsDataEnv)
    if (-not (Test-PathEqual -Left ([string]$legacyPsConfig.dataDir) -Right $legacyPsData)) { throw "PowerShell legacy 업그레이드가 .env DATA_DIR를 기본 경로로 대체했습니다." }
    if (-not (Test-PathEqual -Left ([string]$legacyPsConfig.envFile) -Right $legacyPsDataEnv)) { throw "PowerShell legacy .env를 데이터 폴더로 복사하지 않았습니다." }
    if ($legacyPsDataEnvText -notmatch "(?m)^ADMIN_PASSWORD=0000\s*$" -or
        $legacyPsDataEnvText -notmatch "(?m)^SESSION_SECRET=legacy-session-secret-preserve-this-value\s*$" -or
        $legacyPsDataEnvText -notmatch "(?m)^SEED_SAMPLES=true\s*$") {
        throw "PowerShell legacy 업그레이드가 .env 값을 보존하지 않았습니다."
    }
    if (-not [Linq.Enumerable]::SequenceEqual([byte[]]$legacyPsEnvBytesBefore, [byte[]][IO.File]::ReadAllBytes($legacyPsDataEnv))) {
        throw "PowerShell legacy 업그레이드가 복사한 .env 바이트를 변경했습니다."
    }
    if ((Get-Acl -LiteralPath $legacyPsDataEnv).Sddl -ne $legacyPsEnvAclSddl) { throw "PowerShell legacy .env ACL을 보존하지 않았습니다." }
    if ((Get-FileHash -LiteralPath $legacyPsEnv -Algorithm SHA256).Hash -ne $legacyPsEnvHashBefore -or
        (Get-FileHash -LiteralPath $legacyPsDb -Algorithm SHA256).Hash -ne $legacyPsDbHashBefore -or
        (Get-FileHash -LiteralPath $legacyPsUpload -Algorithm SHA256).Hash -ne $legacyPsUploadHashBefore) {
        throw "PowerShell legacy 업그레이드가 원본 .env, DB 또는 uploads를 변경했습니다."
    }
    if (-not $legacyPsDefaultExisted -and (Test-Path -LiteralPath $legacyPsDefault)) { throw "PowerShell legacy 업그레이드가 새 기본 데이터 경로를 만들었습니다." }
    $report.checks.powerShellLegacyNoManifestUsesEnvDataDir = $true
    $report.checks.powerShellLegacyPreservesEnvAclAndValues = $true
    $report.checks.powerShellLegacyPreservesEnvBytes = $true
    $report.checks.powerShellLegacyPreservesDbAndUploads = $true

    Write-Host "[install-test] 임시 설치 시작: <test-root>"
    $originalLocalAppData = $env:LOCALAPPDATA
    $isolatedLocalAppData = Join-Path $testRoot "local-appdata"
    New-Item -ItemType Directory -Path $isolatedLocalAppData -Force | Out-Null
    $env:LOCALAPPDATA = $isolatedLocalAppData
    try {
        $installOutput = & $installScript -SourceDir $repoRoot -InstallDir $installDir -DataDir $dataDir -Port $port -DebugPort $debugPort -TaskName $taskName -DesktopDir $desktopDir -StartMenuDir $startMenuDir -ProfileDir $profileDir -HeadlessBrowser 2>&1 | Tee-Object -Variable installLines
    } finally {
        $env:LOCALAPPDATA = $originalLocalAppData
    }
    $installLines | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "설치 스크립트가 실패했습니다." }

    Wait-Until -TimeoutSeconds 20 -Description "설치 폴더" -Condition { Test-Path -LiteralPath (Join-Path $installDir "install.json") }
    Wait-Until -TimeoutSeconds 30 -Description "서버 상태" -Condition { Test-ServerHealth -PortNumber $port }
    Wait-Until -TimeoutSeconds 60 -Description "watchdog 상태" -Condition { Test-Path -LiteralPath $statePath }
    $report.checks.installed = $true
    $report.checks.serverHealthy = $true
    $report.checks.headlessTestBrowser = $true
    $report.checks.evidenceUrlsSanitized = $true

    $envFile = Join-Path $dataDir ".env"
    $envText = [IO.File]::ReadAllText($envFile, [Text.UTF8Encoding]::new($false, $true))
    $adminMatch = [regex]::Match($envText, "(?m)^ADMIN_PASSWORD=(.+)$")
    $sessionMatch = [regex]::Match($envText, "(?m)^SESSION_SECRET=(.+)$")
    if (-not $adminMatch.Success -or -not $sessionMatch.Success) { throw "환경 비밀값이 없습니다." }
    $adminPasswordValue = $adminMatch.Groups[1].Value.Trim()
    $sessionSecretValue = $sessionMatch.Groups[1].Value.Trim()
    if ($adminPasswordValue -eq "gugak1234" -or $sessionSecretValue -eq "change-this-to-a-long-random-string") {
        throw "개발용 기본 비밀값이 설치되었습니다."
    }
    if ($adminPasswordValue -ne "0000") {
        throw "신규 설치의 테스트 관리자 비밀번호가 0000이 아닙니다."
    }
    if ($sessionSecretValue.Length -lt 48) {
        throw "생성된 세션 시크릿 길이가 충분하지 않습니다."
    }
    if ($envText -notmatch "(?m)^SEED_SAMPLES=true\s*$") {
        throw "신규 설치가 샘플 시드를 활성화하지 않았습니다."
    }
    $acl = Get-Acl -LiteralPath $envFile
    if (-not $acl.AreAccessRulesProtected) { throw "환경 파일 ACL 상속이 차단되지 않았습니다." }
    $report.checks.sessionSecretRandom = $true
    $report.checks.testAdminPassword0000 = $true
    $report.checks.environmentAclProtected = $true
    $report.checks.newInstallSeedSamples = $true

    $cookieContainer = [System.Net.CookieContainer]::new()
    $httpHandler = [System.Net.Http.HttpClientHandler]::new()
    $httpHandler.CookieContainer = $cookieContainer
    $adminApiClient = [System.Net.Http.HttpClient]::new($httpHandler)
    $loginContent = [System.Net.Http.StringContent]::new('{"password":"0000"}', [Text.Encoding]::UTF8, "application/json")
    $loginResponse = $adminApiClient.PostAsync("http://127.0.0.1:$port/api/auth/login", $loginContent).GetAwaiter().GetResult()
    if (-not $loginResponse.IsSuccessStatusCode) { throw "테스트 관리자 비밀번호 0000 로그인이 실패했습니다: HTTP $([int]$loginResponse.StatusCode)" }
    $baseUri = [Uri]::new("http://127.0.0.1:$port/")
    if ($cookieContainer.GetCookies($baseUri).Count -lt 1) {
        throw "관리자 로그인 세션 쿠키를 받지 못했습니다."
    }
    $report.checks.testAdminPasswordLogin = $true

    $installedConfig = Read-JsonFile -Path (Join-Path $installDir "install.json")
    if (@($installedConfig.adminShortcuts).Count -ne 2) { throw "install.json에 관리자 바로가기 두 개가 기록되지 않았습니다." }
    if ($installedConfig.browserHeadless -ne $true -or $installedConfig.adminAutoOpen.enabled -ne $false) {
        throw "headless 설치의 관리자 페이지 자동 열기 설정이 꺼지지 않았습니다."
    }
    $report.checks.adminShortcutsRecorded = $true
    $report.checks.headlessDisablesAdminAutoOpen = $true

    $shell = New-Object -ComObject WScript.Shell
    $shortcuts = @(
        (Join-Path $desktopDir "열린안내판.lnk"),
        (Join-Path $startMenuDir "열린안내판.lnk")
    )
    foreach ($shortcutPath in $shortcuts) {
        if (-not (Test-Path -LiteralPath $shortcutPath)) { throw "바로가기가 없습니다: $shortcutPath" }
        $shortcut = $shell.CreateShortcut($shortcutPath)
        if ($shortcut.TargetPath -notlike "*wscript.exe") { throw "바로가기 대상이 wscript.exe가 아닙니다." }
        if ($shortcut.Arguments -notlike "*watchdog-launch.vbs*") { throw "바로가기 인자가 watchdog 실행 파일을 가리키지 않습니다." }
    }
    $report.checks.desktopShortcut = $true
    $report.checks.startMenuShortcut = $true
    $adminShortcuts = @(
        (Join-Path $desktopDir "열린안내판 관리자.lnk"),
        (Join-Path $startMenuDir "열린안내판 관리자.lnk")
    )
    foreach ($shortcutPath in $adminShortcuts) {
        if (-not (Test-Path -LiteralPath $shortcutPath)) { throw "관리자 바로가기가 없습니다: $shortcutPath" }
        $shortcut = $shell.CreateShortcut($shortcutPath)
        if ($shortcut.TargetPath -notlike "*wscript.exe") { throw "관리자 바로가기 대상이 wscript.exe가 아닙니다: $shortcutPath" }
        if ($shortcut.Arguments -notlike "*admin-launch.vbs*") { throw "관리자 바로가기 인자가 admin-launch.vbs를 가리키지 않습니다: $($shortcut.Arguments)" }
        if ($shortcut.IconLocation -notlike "*msedge.exe*" -and $shortcut.IconLocation -notlike "*chrome.exe*") {
            throw "관리자 바로가기 아이콘이 설치된 브라우저를 가리키지 않습니다: $($shortcut.IconLocation)"
        }
        if (-not (Test-AdminShortcutOwnedByInstall -ShortcutPath $shortcutPath -InstallDir $installDir)) {
            throw "관리자 바로가기 소유권 확인 실패: $shortcutPath"
        }
    }
    $report.checks.adminDesktopShortcut = $true
    $report.checks.adminStartMenuShortcut = $true
    $report.checks.adminShortcutIcon = $true

    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    if (@($task.Triggers).Count -ne 1) { throw "자동 실행 트리거 수가 예상과 다릅니다." }
    if (-not ([string]$task.Triggers[0].CimClass.CimClassName).Contains("LogonTrigger")) { throw "At log on 트리거가 아닙니다." }
    if ($task.Principal.LogonType -ne "Interactive") { throw "Interactive 사용자 작업이 아닙니다." }
    $report.checks.scheduledTask = $true

    $initialState = Read-WatchdogState -StatePath $statePath
    if (-not (Test-OwnedProcess -ProcessId ([int]$initialState.serverPid))) { throw "초기 서버 프로세스가 없습니다." }
    if ($initialState.browserPid) { throw "자동 실행이 사용자 동작 없이 재생기를 시작했습니다." }
    $initialPlayerState = Read-JsonFile -Path (Join-Path $dataDir "control\player-state.json")
    if ($initialPlayerState.desired -ne "stopped" -or $initialPlayerState.running) {
        throw "새 설치의 재생기 의도 상태가 stopped가 아닙니다."
    }
    $report.checks.playerOffUntilRequested = $true

    $deviceList = ConvertFrom-Json ($adminApiClient.GetStringAsync("http://127.0.0.1:$port/api/devices").GetAwaiter().GetResult())
    $deviceId = [string](@($deviceList.devices)[0].id)
    if (-not $deviceId) { throw "관리자 API에서 기기 ID를 얻지 못했습니다." }
    Invoke-AdminPlayerControl -Client $adminApiClient -PortNumber $port -Action launch -DeviceId $deviceId
    Wait-Until -TimeoutSeconds 25 -Description "관리자 요청에 따른 재생기 프로세스" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        return [bool]($current.browserPid -and (Test-OwnedProcess -ProcessId ([int]$current.browserPid)))
    }
    $initialState = Read-WatchdogState -StatePath $statePath
    $startedPlayerState = Read-JsonFile -Path (Join-Path $dataDir "control\player-state.json")
    if ($startedPlayerState.desired -ne "running" -or -not $startedPlayerState.running -or -not $startedPlayerState.pid) {
        throw "관리자 실행 요청의 재생기 상태가 기록되지 않았습니다."
    }
    $report.checks.playerLaunchedFromAdminApi = $true
    $playerOnlinePath = Join-Path $evidenceDir "player-installed.json"
    $playerScreenshot = Join-Path $evidenceDir "player-installed.png"
    $playerInitial = Invoke-PlayerCheck -Expect "online" -Screenshot $playerScreenshot -Output $playerOnlinePath
    $report.checks.browserProcess = $true
    $report.checks.playerRendering = $true
    $report.checks.playerInitialState = $playerInitial.state
    $report.screenshots += "docs/install/evidence/player-installed.png"

    Wait-Until -TimeoutSeconds 30 -Description "브라우저 실제 재생 상태" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        return ($current.lastBrowserStateKind -in @("playing", "cached"))
    }

    Invoke-AdminPlayerControl -Client $adminApiClient -PortNumber $port -Action stop
    Wait-Until -TimeoutSeconds 15 -Description "재생기 중지" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        return (-not $current.browserPid)
    }
    Start-Sleep -Seconds 2
    $stoppedPlayerState = Read-JsonFile -Path (Join-Path $dataDir "control\player-state.json")
    $stoppedWatchdogState = Read-WatchdogState -StatePath $statePath
    if ($stoppedPlayerState.desired -ne "stopped" -or $stoppedPlayerState.running -or $stoppedWatchdogState.browserPid) {
        throw "명시적 중지 뒤 재생기가 자동 재실행되었습니다."
    }
    $report.checks.playerStopsOnRequest = $true

    Invoke-AdminPlayerControl -Client $adminApiClient -PortNumber $port -Action launch -DeviceId $deviceId
    Wait-Until -TimeoutSeconds 25 -Description "재생기 재실행" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        return [bool]($current.browserPid -and (Test-OwnedProcess -ProcessId ([int]$current.browserPid)))
    }
    $playerReopened = Invoke-PlayerCheck -Expect "online" -Output (Join-Path $evidenceDir "player-relaunch-installed.json")
    $report.checks.playerRelaunchesOnRequest = $true
    $report.checks.playerRelaunchState = $playerReopened.state

    & $nodePath (Join-Path $PSScriptRoot "close-player-window.mjs") ([string]$debugPort) | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "재생기 창 닫기 검증 스크립트가 실패했습니다." }
    Wait-Until -TimeoutSeconds 35 -Description "사용자 재생기 창 닫기" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        $player = Read-JsonFile -Path (Join-Path $dataDir "control\player-state.json")
        return (-not $current.browserPid -and $player.desired -eq "stopped" -and -not $player.running)
    }
    Start-Sleep -Seconds 3
    $closedWatchdogState = Read-WatchdogState -StatePath $statePath
    $closedPlayerState = Read-JsonFile -Path (Join-Path $dataDir "control\player-state.json")
    if ($closedWatchdogState.browserPid -or $closedPlayerState.running) {
        throw "사용자가 재생기 창을 닫은 뒤 watchdog이 재생기를 다시 실행했습니다."
    }
    $report.checks.userClosedPlayerStaysStopped = $true

    $configBeforeUpgrade = Read-JsonFile -Path (Join-Path $installDir "install.json")
    $databasePath = Join-Path $dataDir "signage.sqlite"
    $shortcutPathsBefore = @($configBeforeUpgrade.shortcuts)
    $adminShortcutPathsBefore = @($configBeforeUpgrade.adminShortcuts)
    $taskNameBefore = [string]$configBeforeUpgrade.taskName
    $watchdogPidBeforeUpgrade = [int](Read-WatchdogState -StatePath $statePath).watchdogPid

    & (Join-Path $installDir "ops\stop.ps1") -Quiet
    Wait-Until -TimeoutSeconds 20 -Description "업그레이드 전 서비스 중지" -Condition { -not (Test-ServerHealth -PortNumber $port) }
    $databaseHashBefore = (Get-FileHash -LiteralPath $databasePath -Algorithm SHA256).Hash
    $envBytesBeforeUpgrade = [IO.File]::ReadAllBytes($envFile)
    $envAclBeforeUpgrade = (Get-Acl -LiteralPath $envFile).Sddl
    & $installScript -SourceDir $repoRoot -InstallDir $installDir -NoStart 2>&1 | Tee-Object -Variable upgradeLines | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "기존 설치 업그레이드가 실패했습니다." }
    $configAfterUpgrade = Read-JsonFile -Path (Join-Path $installDir "install.json")
    $envAfterUpgrade = [IO.File]::ReadAllText($envFile, [Text.UTF8Encoding]::new($false, $true))
    if (-not (Test-PathEqual -Left ([string]$configAfterUpgrade.dataDir) -Right $dataDir)) {
        throw "업그레이드가 기존 데이터 경로를 보존하지 않았습니다."
    }
    if (-not (Test-PathEqual -Left ([string]$configAfterUpgrade.installDir) -Right $installDir)) {
        throw "업그레이드가 설치 경로를 변경했습니다."
    }
    if ([string]$configAfterUpgrade.taskName -ne $taskNameBefore) {
        throw "업그레이드가 작업 이름을 기본값으로 덮어썼습니다."
    }
    $shortcutPathsAfter = @($configAfterUpgrade.shortcuts)
    if ($shortcutPathsAfter.Count -ne $shortcutPathsBefore.Count) { throw "업그레이드가 바로가기 구성 수를 변경했습니다." }
    for ($index = 0; $index -lt $shortcutPathsBefore.Count; $index++) {
        if (-not (Test-PathEqual -Left ([string]$shortcutPathsBefore[$index]) -Right ([string]$shortcutPathsAfter[$index]))) {
            throw "업그레이드가 바로가기 경로를 기본값으로 덮어썼습니다."
        }
    }
    $adminShortcutPathsAfter = @($configAfterUpgrade.adminShortcuts)
    if ($adminShortcutPathsAfter.Count -ne $adminShortcutPathsBefore.Count) { throw "업그레이드가 관리자 바로가기 구성 수를 변경했습니다." }
    for ($index = 0; $index -lt $adminShortcutPathsBefore.Count; $index++) {
        if (-not (Test-PathEqual -Left ([string]$adminShortcutPathsBefore[$index]) -Right ([string]$adminShortcutPathsAfter[$index]))) {
            throw "업그레이드가 관리자 바로가기 경로를 기본값으로 덮어썼습니다."
        }
    }
    if (-not [Linq.Enumerable]::SequenceEqual([byte[]]$envBytesBeforeUpgrade, [byte[]][IO.File]::ReadAllBytes($envFile))) {
        throw "업그레이드가 기존 .env의 바이트를 변경했습니다."
    }
    if ((Get-Acl -LiteralPath $envFile).Sddl -ne $envAclBeforeUpgrade) {
        throw "업그레이드가 기존 .env의 ACL을 변경했습니다."
    }
    if ($envAfterUpgrade -notmatch "(?m)^ADMIN_PASSWORD=0000\s*$") {
        throw "업그레이드가 기존 .env의 관리자 비밀번호를 변경했습니다."
    }
    if ($configAfterUpgrade.browserHeadless -ne $true) {
        throw "업그레이드가 테스트 headless 브라우저 설정을 보존하지 않았습니다."
    }
    $databaseHashAfter = (Get-FileHash -LiteralPath $databasePath -Algorithm SHA256).Hash
    if ($databaseHashAfter -ne $databaseHashBefore) {
        throw "업그레이드가 기존 데이터베이스를 변경했습니다."
    }
    $report.checks.upgradePreservesDataDir = $true
    $report.checks.upgradePreservesDatabase = $true
    $report.checks.upgradePreservesShortcutsAndTask = $true
    $report.checks.upgradePreservesEnvBytesAndAcl = $true
    $report.checks.existingEnvPreserved = $true
    $report.checks.headlessSettingPreservedOnUpgrade = $true

    $changedDataDir = Join-Path $testRoot "changed-data"
    $changeError = $null
    try {
        & $installScript -SourceDir $repoRoot -InstallDir $installDir -DataDir $changedDataDir -NoStart -NoAutoStart 2>&1 | Out-Null
    } catch {
        $changeError = $_.Exception.Message
    }
    if (-not $changeError -or $changeError -notmatch "AllowDataDirChange") {
        throw "기존 데이터 경로 변경이 명시 확인 없이 허용되었습니다."
    }
    if (Test-Path -LiteralPath $changedDataDir) { throw "거부된 데이터 경로 변경에서 새 폴더가 생성되었습니다." }
    $report.checks.dataDirChangeRequiresExplicitConfirmation = $true

    Start-ScheduledTask -TaskName $taskName
    Wait-Until -TimeoutSeconds 90 -Description "업그레이드 후 서버 시작" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        return ($current.watchdogPid -and [int]$current.watchdogPid -ne $watchdogPidBeforeUpgrade -and
            (Test-OwnedProcess -ProcessId ([int]$current.watchdogPid)) -and
            (Test-ServerHealth -PortNumber $port))
    }
    $afterUpgradeState = Read-WatchdogState -StatePath $statePath
    if ($afterUpgradeState.browserPid) { throw "업그레이드 후 watchdog 재시작이 재생기를 자동 실행했습니다." }
    Invoke-AdminPlayerControl -Client $adminApiClient -PortNumber $port -Action launch -DeviceId $deviceId
    Wait-Until -TimeoutSeconds 25 -Description "업그레이드 후 관리자 재생기 실행" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        return [bool]($current.browserPid -and (Test-OwnedProcess -ProcessId ([int]$current.browserPid)))
    }
    $initialState = Read-WatchdogState -StatePath $statePath
    Wait-Until -TimeoutSeconds 30 -Description "업그레이드 후 브라우저 재생 상태" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        return ($current.lastBrowserStateKind -in @("playing", "cached"))
    }
    $initialState = Read-WatchdogState -StatePath $statePath
    if (-not $initialState.watchdogStartedAt -or -not $initialState.serverStartedAt -or -not $initialState.browserStartedAt) {
        throw "PID 소유권 검증에 필요한 프로세스 시작 시각이 상태 파일에 없습니다."
    }
    $report.checks.pidIdentityMetadataRecorded = $true

    $serverPidBefore = [int]$initialState.serverPid
    $serverKillAt = [DateTime]::UtcNow
    Stop-Process -Id $serverPidBefore -Force
    Wait-Until -TimeoutSeconds 40 -Description "서버 자동 재시작" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        return ($current.serverPid -and [int]$current.serverPid -ne $serverPidBefore -and (Test-OwnedProcess -ProcessId ([int]$current.serverPid)) -and (Test-ServerHealth -PortNumber $port))
    }
    $serverRestartState = Read-WatchdogState -StatePath $statePath
    $report.checks.serverRestartedAfterKill = $true
    $report.checks.serverRestartSeconds = [Math]::Round(([DateTime]::UtcNow - $serverKillAt).TotalSeconds, 1)
    $report.checks.serverPidBefore = $serverPidBefore
    $report.checks.serverPidAfter = [int]$serverRestartState.serverPid

    $browserPidBefore = [int]$serverRestartState.browserPid
    $browserKillAt = [DateTime]::UtcNow
    Stop-Process -Id $browserPidBefore -Force
    Wait-Until -TimeoutSeconds 45 -Description "브라우저 자동 재시작" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        return ($current.browserPid -and [int]$current.browserPid -ne $browserPidBefore -and (Test-OwnedProcess -ProcessId ([int]$current.browserPid)))
    }
    $browserAfterPath = Join-Path $evidenceDir "player-after-browser-restart.json"
    $playerAfterBrowser = Invoke-PlayerCheck -Expect "online" -Screenshot "" -Output $browserAfterPath
    $browserRestartState = Read-WatchdogState -StatePath $statePath
    $report.checks.browserRestartedAfterKill = $true
    $report.checks.browserRestartSeconds = [Math]::Round(([DateTime]::UtcNow - $browserKillAt).TotalSeconds, 1)
    $report.checks.browserPidBefore = $browserPidBefore
    $report.checks.browserPidAfter = [int]$browserRestartState.browserPid

    $watchdogPidBeforeDisable = [int](Read-WatchdogState -StatePath $statePath).watchdogPid
    & (Join-Path $installDir "tools\set-autostart.ps1") -Disable | Out-Host
    Wait-Until -TimeoutSeconds 25 -Description "자동 실행 비활성화" -Condition {
        $taskNow = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        return ($taskNow.State -eq "Disabled" -and -not (Test-ServerHealth -PortNumber $port))
    }
    $report.checks.autostartCanBeDisabled = $true

    $stoppedServerInstance = Read-JsonFile -Path (Join-Path $dataDir "control\server-instance.json")
    $commandPath = Join-Path $dataDir "control\player-command.json"
    $staleCommand = [ordered]@{
        schemaVersion = 1
        id = [guid]::NewGuid().ToString()
        serverInstanceId = [string]$stoppedServerInstance.id
        action = "launch"
        deviceId = $deviceId
        deviceName = "stale"
        playerUrl = "http://127.0.0.1:$port/player/?code=GUGAK1&reconnect=1"
        requestedAt = [DateTime]::UtcNow.ToString("o")
    }
    [IO.File]::WriteAllText($commandPath, ($staleCommand | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))

    & (Join-Path $installDir "tools\set-autostart.ps1") -Enable | Out-Host
    Wait-Until -TimeoutSeconds 60 -Description "자동 실행 재활성화 서버" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        return ($current.watchdogPid -and [int]$current.watchdogPid -ne $watchdogPidBeforeDisable -and
            (Test-OwnedProcess -ProcessId ([int]$current.watchdogPid)) -and
            (Test-ServerHealth -PortNumber $port))
    }
    $reenabledState = Read-WatchdogState -StatePath $statePath
    if ($reenabledState.browserPid) { throw "자동 실행 재활성화가 재생기를 자동 실행했습니다." }
    Wait-Until -TimeoutSeconds 15 -Description "이전 서버 인스턴스 명령 제거" -Condition {
        return -not (Test-Path -LiteralPath $commandPath)
    }
    $staleCommandState = Read-JsonFile -Path (Join-Path $dataDir "control\player-state.json")
    if ($staleCommandState.running -or $staleCommandState.desired -ne "stopped") {
        throw "이전 서버 인스턴스의 launch 명령이 재생기를 시작했습니다."
    }
    $report.checks.staleServerCommandIgnored = $true

    $currentServerInstance = Read-JsonFile -Path (Join-Path $dataDir "control\server-instance.json")
    $expiredCommand = [ordered]@{
        schemaVersion = 1
        id = [guid]::NewGuid().ToString()
        serverInstanceId = [string]$currentServerInstance.id
        action = "launch"
        deviceId = $deviceId
        deviceName = "expired"
        playerUrl = "http://127.0.0.1:$port/player/?code=GUGAK1&reconnect=1"
        requestedAt = [DateTime]::UtcNow.AddSeconds(-31).ToString("o")
    }
    [IO.File]::WriteAllText($commandPath, ($expiredCommand | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
    Wait-Until -TimeoutSeconds 15 -Description "TTL 만료 명령 제거" -Condition {
        return -not (Test-Path -LiteralPath $commandPath)
    }
    if ((Read-WatchdogState -StatePath $statePath).browserPid) { throw "TTL 만료 launch 명령이 재생기를 시작했습니다." }
    $report.checks.expiredServerCommandIgnored = $true

    Invoke-AdminPlayerControl -Client $adminApiClient -PortNumber $port -Action launch -DeviceId $deviceId
    Wait-Until -TimeoutSeconds 60 -Description "자동 실행 재활성화" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        return ($current.watchdogPid -and [int]$current.watchdogPid -ne $watchdogPidBeforeDisable -and
            (Test-OwnedProcess -ProcessId ([int]$current.watchdogPid)) -and
            (Test-OwnedProcess -ProcessId ([int]$current.browserPid)) -and
            (Test-ServerHealth -PortNumber $port))
    }
    $report.checks.autostartCanBeReenabled = $true

    & (Join-Path $installDir "tools\set-autostart.ps1") -Disable -KeepRunning | Out-Host
    if ((Get-ScheduledTask -TaskName $taskName -ErrorAction Stop).State -ne "Disabled") {
        throw "서버 단절 시험 전에 자동 재시작 작업을 비활성화하지 못했습니다."
    }
    $enabledState = Read-WatchdogState -StatePath $statePath
    $watchdogProcess = Get-VerifiedOwnedProcess -ProcessId ([int]$enabledState.watchdogPid) -ExpectedExecutable ([string]$configAfterUpgrade.nodePath) -ExpectedStartTime ([string]$enabledState.watchdogStartedAt) -CommandLineContains @($installDir, "watchdog.mjs")
    if (-not $watchdogProcess) { throw "강제 종료 대상 watchdog의 소유권을 확인하지 못했습니다." }
    & taskkill.exe /PID ([int]$enabledState.watchdogPid) /F *> $null
    if ($LASTEXITCODE -ne 0 -and (Test-OwnedProcess -ProcessId ([int]$enabledState.watchdogPid))) {
        throw "watchdog 강제 종료에 실패했습니다."
    }
    Wait-Until -TimeoutSeconds 15 -Description "watchdog 프로세스 종료" -Condition {
        return -not (Test-OwnedProcess -ProcessId ([int]$enabledState.watchdogPid))
    }
    Wait-Until -TimeoutSeconds 15 -Description "서버 단절" -Condition { -not (Test-ServerHealth -PortNumber $port) }
    Wait-Until -TimeoutSeconds 15 -Description "watchdog 강제 종료 시 서버 고아 정리" -Condition {
        return -not (Test-OwnedProcess -ProcessId ([int]$enabledState.serverPid))
    }
    $report.checks.watchdogKillDoesNotOrphanServer = $true
    if (-not (Test-OwnedProcess -ProcessId ([int]$enabledState.browserPid))) {
        throw "watchdog 종료 후에도 유지되어야 할 브라우저가 함께 종료되었습니다."
    }
    $offlinePath = Join-Path $evidenceDir "player-offline-installed.json"
    $offlineScreenshot = Join-Path $evidenceDir "player-offline-installed.png"
    $offlineStart = Invoke-PlayerCheck -Expect "offline" -Screenshot $offlineScreenshot -Output $offlinePath
    Start-Sleep -Seconds 13
    $offlineProgressPath = Join-Path $evidenceDir "player-offline-progress.json"
    $offlineProgress = Invoke-PlayerCheck -Expect "offline" -Screenshot "" -Output $offlineProgressPath
    if ($offlineStart.state.currentContentId -eq $offlineProgress.state.currentContentId) {
        throw "서버 단절 중 재생 위치가 진행되지 않았습니다."
    }
    $report.checks.playerContinuesCachedPlayback = $true
    $report.checks.offlineContentBefore = $offlineStart.state.currentContentId
    $report.checks.offlineContentAfter = $offlineProgress.state.currentContentId
    $report.screenshots += "docs/install/evidence/player-offline-installed.png"

    & (Join-Path $installDir "tools\set-autostart.ps1") -Enable | Out-Host
    Wait-Until -TimeoutSeconds 60 -Description "서버 연결 자동 복구" -Condition { Test-ServerHealth -PortNumber $port }
    Wait-Until -TimeoutSeconds 30 -Description "정상 재생기 PID 소유권 채택" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        $player = Read-JsonFile -Path (Join-Path $dataDir "control\player-state.json")
        return ($current.browserPid -and [int]$current.browserPid -eq [int]$enabledState.browserPid -and $player.running)
    }
    $report.checks.verifiedExistingPlayerAdopted = $true
    $recoveryPath = Join-Path $evidenceDir "player-recovered-installed.json"
    $recovered = Invoke-PlayerCheck -Expect "online" -Screenshot "" -Output $recoveryPath
    $report.checks.playerRecoveredAfterServerReturn = $true
    $report.checks.playerRecoveredState = $recovered.state

    $watchdogBeforeManualRestart = [int](Read-WatchdogState -StatePath $statePath).watchdogPid
    & (Join-Path $installDir "tools\set-autostart.ps1") -Restart | Out-Host
    Wait-Until -TimeoutSeconds 60 -Description "수동 watchdog 재시작" -Condition {
        $current = Read-WatchdogState -StatePath $statePath
        return ($current.watchdogPid -and [int]$current.watchdogPid -ne $watchdogBeforeManualRestart -and
            (Test-OwnedProcess -ProcessId ([int]$current.watchdogPid)) -and
            (Test-ServerHealth -PortNumber $port))
    }
    $report.checks.manualRestartRecoversWatchdog = $true

    & (Join-Path $installDir "tools\uninstall.ps1") | Out-Host
    $uninstallCompleted = $true
    if (Test-Path -LiteralPath $installDir) { throw "제거 후 설치 폴더가 남아 있습니다." }
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw "제거 후 자동 실행 작업이 남아 있습니다." }
    foreach ($shortcutPath in $shortcuts) {
        if (Test-Path -LiteralPath $shortcutPath) { throw "제거 후 바로가기가 남아 있습니다." }
    }
    foreach ($shortcutPath in $adminShortcuts) {
        if (Test-Path -LiteralPath $shortcutPath) { throw "제거 후 관리자 바로가기가 남아 있습니다." }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $dataDir ".env"))) { throw "제거가 데이터 환경 파일을 삭제했습니다." }
    if (-not (Test-Path -LiteralPath (Join-Path $dataDir "signage.sqlite"))) { throw "제거가 데이터베이스를 삭제했습니다." }
    $report.checks.uninstallRemovedApplication = $true
    $report.checks.uninstallPreservedDataByDefault = $true
    $report.result = "passed"
} catch {
    $report.result = "failed"
    $report.error = $_.Exception.Message
    throw
} finally {
    $report.finishedAt = [DateTime]::UtcNow.ToString("o")
    try {
        if (-not $uninstallCompleted -and (Test-Path -LiteralPath (Join-Path $installDir "tools\uninstall.ps1"))) {
            & (Join-Path $installDir "tools\uninstall.ps1") -KeepInstallFiles -Quiet | Out-Host
        }
    } catch {
        Write-Warning "실패 정리 중 제거 오류: $($_.Exception.Message)"
    }
    if ($transcriptStarted) { Stop-Transcript | Out-Null }

    $reportPath = Join-Path $evidenceDir "installer-verification.json"
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
    foreach ($jsonFile in Get-ChildItem -LiteralPath $evidenceDir -Filter "*.json") {
        Sanitize-Evidence -Source $jsonFile.FullName -Destination $jsonFile.FullName
    }

    $installLog = Get-ChildItem -LiteralPath (Join-Path $dataDir "logs") -Filter "install-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
    $uninstallLog = Get-ChildItem -LiteralPath (Join-Path $dataDir "logs") -Filter "uninstall-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
    if ($installLog) { Sanitize-Evidence -Source $installLog.FullName -Destination (Join-Path $evidenceDir "installer-run.txt") }
    if ($uninstallLog) { Sanitize-Evidence -Source $uninstallLog.FullName -Destination (Join-Path $evidenceDir "uninstaller-run.txt") }
    Sanitize-Evidence -Source (Join-Path $dataDir "logs\watchdog.log") -Destination (Join-Path $evidenceDir "watchdog-run.txt")
    Sanitize-Evidence -Source $rawLog -Destination (Join-Path $evidenceDir "verification-run.txt")

    if (-not $KeepTestArtifacts) {
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
        if ($resolvedTestRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
            ([IO.Path]::GetFileName($resolvedTestRoot).StartsWith("GugakSignage-install-test-"))) {
            Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "[install-test] 테스트 산출물 보존: $testRoot"
    }
}
