# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$SourceDir = "",
    [string]$InstallDir = "",
    [string]$DataDir = "",
    [int]$Port = 3000,
    [ValidateSet("all", "manager", "player")][string]$Role = "",
    [ValidateSet("standalone", "lan")][string]$Mode = "",
    [string]$TlsCertFile = "",
    [string]$TlsKeyFile = "",
    [string]$ManagerUrl = "",
    [string]$ManagerCaFile = "",
    [string]$ManagerBaseUrl = "",
    [string]$PlayerUrl = "",
    [string]$BrowserPath = "",
    [string]$NodePath = "",
    [string]$TaskName = "",
    [string]$FirewallRuleName = "",
    [string]$DesktopDir = "",
    [string]$StartMenuDir = "",
    [string]$ProfileDir = "",
    [string]$LogDir = "",
    [int]$DebugPort = 0,
    [switch]$OpenFirewall,
    [switch]$NoAutoStart,
    [switch]$NoStart,
    [switch]$ConfigureOnly,
    [switch]$AllowDataDirChange,
    [switch]$HeadlessBrowser,
    [switch]$NoAdminAutoOpen,
    [switch]$OpenAdminOnStartup
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
$commonPath = Join-Path $PSScriptRoot "ops\install-common.ps1"
if (-not (Test-Path -LiteralPath $commonPath)) {
    $commonPath = Join-Path $PSScriptRoot "..\ops\install-common.ps1"
}
. $commonPath

$script:TranscriptStarted = $false
$script:InstallLogPath = $null

function Write-Step {
    param([string]$Message)
    Write-Host "[GugakSignage] $Message"
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
}

function New-RandomSecret {
    param([int]$ByteCount = 32)
    $bytes = [byte[]]::new($ByteCount)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Protect-EnvironmentFile {
    param([string]$Path)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path /inheritance:r /grant:r "*$($sid):(R,W)" "*S-1-5-18:(F)" "*S-1-5-32-544:(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "환경 설정 파일의 ACL을 보호하지 못했습니다: $Path"
    }
}

function Copy-EnvironmentFilePreservingAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    $sourceAcl = Get-Acl -LiteralPath $Source
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
    Set-Acl -LiteralPath $Destination -AclObject $sourceAcl
}

function Set-EnvSetting {
    param([string]$Path, [string]$Name, [string]$Value)
    $text = [IO.File]::ReadAllText($Path)
    $escapedValue = $Value.Replace('\', '\\').Replace('"', '\\"')
    $line = $Name + '="' + $escapedValue + '"'
    if ($text -match "(?m)^$([regex]::Escape($Name))=.*$") {
        $text = [regex]::Replace($text, "(?m)^$([regex]::Escape($Name))=.*$", [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $line })
    } else {
        $text = $text.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
    }
    [IO.File]::WriteAllText($Path, $text, [Text.UTF8Encoding]::new($false))
}

function Find-Browser {
    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    $candidates = @(
        (Join-Path $programFilesX86 "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path $programFilesX86 "Google\Chrome\Application\chrome.exe")
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "Microsoft Edge 또는 Google Chrome을 찾지 못했습니다. 브라우저를 설치한 뒤 다시 실행하세요."
}

function Test-TcpPortAvailable {
    param([int]$PortNumber)
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $PortNumber)
    try {
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        try { $listener.Stop() } catch { }
    }
}

function Find-DebugPort {
    for ($candidate = 9222; $candidate -le 9322; $candidate++) {
        if (Test-TcpPortAvailable -PortNumber $candidate) { return $candidate }
    }
    throw "브라우저 감시용 로컬 포트를 찾지 못했습니다."
}

function Write-InstallConfig {
    param(
        [string]$ConfigPath,
        [string[]]$Shortcuts,
        [string[]]$AdminShortcuts,
        [bool]$AdminAutoOpenEnabled,
        $PreviousConfig,
        [bool]$AutoStartRegistered,
        [string]$WatchdogRole
    )
    $createdAt = if ($PreviousConfig -and $PreviousConfig.createdAt) {
        [string]$PreviousConfig.createdAt
    } else {
        [DateTime]::UtcNow.ToString("o")
    }
    $config = [ordered]@{
        schemaVersion       = 2
        product             = "GugakSignage"
        ownershipMarker     = "GugakSignage installer"
        installDir          = $InstallDir
        dataDir             = $DataDir
        envFile             = $envFile
        logDir              = $LogDir
        port                = $Port
        role                = $WatchdogRole
        setupRole           = $Role
        mode                = $Mode
        tlsCertFile         = $TlsCertFile
        tlsKeyFile          = $TlsKeyFile
        managerUrl          = $ManagerUrl
        managerCaFile       = $ManagerCaFile
        managerBaseUrl      = $ManagerBaseUrl
        playerAutoStart     = ($WatchdogRole -eq "player-host")
        adminUrl            = if ($Role -eq "player") { $null } elseif ($Role -eq "manager" -and $Mode -eq "lan") { $ManagerBaseUrl.TrimEnd('/') + "/admin/" } else { "http://127.0.0.1:$Port/admin/" }
        playerUrl           = $PlayerUrl
        browserPath         = $BrowserPath
        nodePath            = $NodePath
        profileDir          = $ProfileDir
        taskName            = $TaskName
        firewallRuleName    = $FirewallRuleName
        debugPort           = $DebugPort
        browserHeadless     = $useHeadlessBrowser
        shortcuts           = $Shortcuts
        adminShortcuts      = $AdminShortcuts
        adminAutoOpen       = [ordered]@{
            enabled = $AdminAutoOpenEnabled
        }
        autoStartRegistered = $AutoStartRegistered
        createdAt           = $createdAt
        updatedAt           = [DateTime]::UtcNow.ToString("o")
        watchdog            = [ordered]@{
            healthIntervalMs              = 5000
            browserCheckIntervalMs        = 15000
            serverStartupGraceMs          = 120000
            browserStartupGraceMs         = 120000
            browserTargetMissingGraceMs   = 15000
            serverHealthFailureThreshold  = 5
            browserHealthFailureThreshold = 3
            serverHeartbeatMaxAgeMs       = 90000
            serverBackoffInitialMs        = 2000
            serverBackoffMaxMs            = 60000
            browserBackoffInitialMs       = 3000
            browserBackoffMaxMs           = 60000
            maxConsecutiveFailures        = 8
            stableResetMs                 = 60000
            logMaxBytes                   = 5242880
        }
    }
    $json = $config | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText($ConfigPath, $json, [Text.UTF8Encoding]::new($false))
}

function New-Shortcut {
    param(
        [string]$ShortcutPath,
        [string]$Description
    )
    $parent = Split-Path -Parent $ShortcutPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    return Save-WindowsShortcut -ShortcutPath $ShortcutPath `
        -TargetPath (Join-Path $env:SystemRoot "System32\wscript.exe") `
        -Arguments ('//B //NoLogo "' + (Join-Path $InstallDir "ops\watchdog-launch.vbs") + '"') `
        -WorkingDirectory $InstallDir -Description $Description -IconPath $BrowserPath
}

function New-AdminShortcut {
    param(
        [string]$ShortcutPath,
        [string]$Description
    )
    $parent = Split-Path -Parent $ShortcutPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    return Save-WindowsShortcut -ShortcutPath $ShortcutPath `
        -TargetPath (Join-Path $env:SystemRoot "System32\wscript.exe") `
        -Arguments ('//B //NoLogo "' + (Join-Path $InstallDir "ops\admin-launch.vbs") + '"') `
        -WorkingDirectory $InstallDir -Description $Description -IconPath $BrowserPath
}

function Test-AdminShortcutOwnedByInstall {
    param([string]$ShortcutPath, [string]$InstallDir)
    if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) { return $true }
    $targetPath = [GugakShortcutNative]::GetTargetPath($ShortcutPath)
    $arguments = [GugakShortcutNative]::GetArguments($ShortcutPath)
    $workingDirectory = [GugakShortcutNative]::GetWorkingDirectory($ShortcutPath)
    $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
    $launcher = Join-Path $InstallDir "ops\admin-launch.vbs"
    if ((Test-PathEqual -Left $targetPath -Right $wscript) -and
        $arguments.IndexOf($launcher, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        (Test-PathEqual -Left $workingDirectory -Right $InstallDir)) { return $true }
    return $false
}

function Register-WatchdogTask {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing -and -not (Test-ScheduledTaskOwnedByInstall -Task $existing -InstallDir $InstallDir)) {
        throw "같은 이름의 다른 작업 스케줄러 항목이 있습니다. 덮어쓰지 않았습니다: $TaskName"
    }
    $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
    $launcher = Join-Path $InstallDir "ops\watchdog-launch.vbs"
    $taskArguments = '//B //NoLogo "' + $launcher + '"'
    $action = New-ScheduledTaskAction -Execute $wscript -Argument $taskArguments -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
    $trigger.Delay = "PT15S"
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
    $settings.Hidden = $true
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "GugakSignage 서버와 재생기를 감시하고 로그인 후 자동 실행합니다." -Force | Out-Null
}

function Wait-ServerHealth {
    param([int]$TimeoutSeconds = 150)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(2)
    $healthPort = if ($watchdogRole -eq "player-host") { 43127 } else { $Port }
    $healthService = if ($watchdogRole -eq "player-host") { "gugak-player-host" } else { "gugak-signage" }
    $healthUrl = if ($watchdogRole -eq "manager" -and $Mode -eq "lan") { $ManagerBaseUrl.TrimEnd('/') + "/api/health" } else { "http://127.0.0.1:$healthPort/api/health" }
    try {
        while ([DateTime]::UtcNow -lt $deadline) {
            try {
                $content = $client.GetStringAsync($healthUrl).GetAwaiter().GetResult()
                $response = $content | ConvertFrom-Json
                if ($response.ok -and $response.service -eq $healthService) { return $true }
            } catch {
            }
            Start-Sleep -Milliseconds 500
        }
    } finally {
        $client.Dispose()
    }
    return $false
}

$isAdmin = Test-IsAdministrator
if (-not $InstallDir) {
    $InstallDir = if ($isAdmin) {
        Join-Path $env:ProgramFiles "GugakSignage"
    } else {
        Join-Path $env:LOCALAPPDATA "Programs\GugakSignage"
    }
}
$InstallDir = Get-NormalizedPath -Path $InstallDir

$configPath = Join-Path $InstallDir "install.json"
$previousConfig = if (Test-Path -LiteralPath $configPath) {
    Read-JsonFile -Path $configPath
} else {
    $null
}
$roleExplicit = $PSBoundParameters.ContainsKey("Role") -and $Role
if (-not $roleExplicit) {
    $Role = if ($previousConfig -and $previousConfig.setupRole) { [string]$previousConfig.setupRole } else { "all" }
}
if (-not $Mode) { $Mode = if ($previousConfig -and $previousConfig.mode) { [string]$previousConfig.mode } else { "standalone" } }
if (-not $TlsCertFile -and $previousConfig) { $TlsCertFile = [string]$previousConfig.tlsCertFile }
if (-not $TlsKeyFile -and $previousConfig) { $TlsKeyFile = [string]$previousConfig.tlsKeyFile }
if (-not $ManagerUrl -and $previousConfig) { $ManagerUrl = [string]$previousConfig.managerUrl }
if (-not $ManagerCaFile -and $previousConfig) { $ManagerCaFile = [string]$previousConfig.managerCaFile }
if (-not $ManagerBaseUrl -and $previousConfig) { $ManagerBaseUrl = [string]$previousConfig.managerBaseUrl }
if ($Role -eq "all" -and $Mode -ne "standalone") { throw "GUGAK_ROLE=all only supports GUGAK_MODE=standalone." }
if ($Role -eq "player" -and $Mode -ne "lan") { throw "Player-only installs require LAN mode and an HTTPS Manager." }
if ($Role -eq "manager" -and $Mode -eq "lan") {
    if (-not $TlsCertFile -or -not $TlsKeyFile -or !(Test-Path -LiteralPath $TlsCertFile -PathType Leaf) -or !(Test-Path -LiteralPath $TlsKeyFile -PathType Leaf)) { throw "LAN Manager requires existing TLS certificate and key files." }
    $TlsCertFile = (Resolve-Path -LiteralPath $TlsCertFile).Path
    $TlsKeyFile = (Resolve-Path -LiteralPath $TlsKeyFile).Path
    $managerBaseUri = $null
    if (-not [Uri]::TryCreate($ManagerBaseUrl, [UriKind]::Absolute, [ref]$managerBaseUri) -or
        $managerBaseUri.Scheme -ne "https" -or $managerBaseUri.UserInfo -or $managerBaseUri.Query -or $managerBaseUri.Fragment -or
        ($managerBaseUri.AbsolutePath -ne "/" -and $managerBaseUri.AbsolutePath -ne "")) {
        throw "LAN Manager requires an HTTPS base URL with no path, query, or fragment."
    }
    if ($managerBaseUri.Port -ne $Port) { throw "Manager HTTPS base URL port must match the configured listener port." }
    $ManagerBaseUrl = $managerBaseUri.GetLeftPart([UriPartial]::Authority).TrimEnd('/')
}
if ($Role -eq "player" -and $Mode -eq "lan") {
    $managerUri = $null
    if (-not [Uri]::TryCreate($ManagerUrl, [UriKind]::Absolute, [ref]$managerUri) -or $managerUri.Scheme -ne "https") { throw "LAN Player requires an HTTPS Manager URL." }
    if (-not $ManagerCaFile -or !(Test-Path -LiteralPath $ManagerCaFile -PathType Leaf)) { throw "LAN Player requires an existing CA certificate file." }
    $ManagerCaFile = (Resolve-Path -LiteralPath $ManagerCaFile).Path
}
if ($Role -eq "player" -and $ManagerUrl) {
    $managerUri = $null
    if (-not [Uri]::TryCreate($ManagerUrl, [UriKind]::Absolute, [ref]$managerUri)) { throw "Player Host Manager URL must be an absolute HTTP(S) URL." }
    $managerAddress = $null
    $isLoopbackManager = $managerUri.Host -eq "localhost" -or
        ([Net.IPAddress]::TryParse($managerUri.Host, [ref]$managerAddress) -and [Net.IPAddress]::IsLoopback($managerAddress))
    if ($managerUri.Scheme -ne "https" -and -not $isLoopbackManager) { throw "Player Host requires HTTPS for every non-loopback Manager URL." }
}
$watchdogRole = switch ($Role) { "all" { "integrated" } "manager" { "manager" } "player" { "player-host" } }
if ($previousConfig -and -not (Test-PathEqual -Left ([string]$previousConfig.installDir) -Right $InstallDir)) {
    throw "기존 install.json의 설치 경로가 현재 대상과 다릅니다. 다른 설치를 덮어쓰지 않습니다: $($previousConfig.installDir)"
}
$useHeadlessBrowser = if ($PSBoundParameters.ContainsKey("HeadlessBrowser")) {
    [bool]$HeadlessBrowser
} elseif ($previousConfig -and $previousConfig.browserHeadless -eq $true) {
    $true
} else {
    $false
}

$adminAutoOpenEnabled = if ($NoAdminAutoOpen) {
    $false
} elseif ($useHeadlessBrowser) {
    $false
} elseif ($OpenAdminOnStartup) {
    $true
} elseif ($previousConfig -and ($previousConfig.PSObject.Properties.Name -contains "adminAutoOpen") -and
    $null -ne $previousConfig.adminAutoOpen -and
    ($previousConfig.adminAutoOpen.PSObject.Properties.Name -contains "enabled")) {
    [bool]$previousConfig.adminAutoOpen.enabled
} else {
    $true
}
if ($Role -eq "player") { $adminAutoOpenEnabled = $false }
$defaultDataDir = if ($isAdmin) {
    Join-Path $env:ProgramData "GugakSignage"
} else {
    Join-Path $env:LOCALAPPDATA "GugakSignage"
}
$resolvedData = Resolve-InstallerDataDir -InstallDir $InstallDir -DefaultDataDir $defaultDataDir
$previousDataDir = if ($resolvedData.HasPreviousEvidence) { [string]$resolvedData.DataDir } else { "" }

$dataDirWasExplicit = -not [string]::IsNullOrWhiteSpace($DataDir)
if (-not $dataDirWasExplicit) {
    $DataDir = [string]$resolvedData.DataDir
}
$DataDir = Get-NormalizedPath -Path $DataDir
$dataDirChanged = $previousDataDir -and -not (Test-PathEqual -Left $previousDataDir -Right $DataDir)
if ($dataDirChanged -and -not $AllowDataDirChange) {
    throw "기존 데이터 폴더와 다른 경로가 지정되었습니다. 새 빈 데이터 폴더가 생길 수 있으므로 -AllowDataDirChange로 명시 확인한 경우에만 변경합니다. 기존: $previousDataDir, 요청: $DataDir"
}

Assert-DataDirOutsideInstall -InstallDir $InstallDir -DataDir $DataDir

$existingDataDetected = [bool]$resolvedData.HasPreviousEvidence
if (Test-Path -LiteralPath (Join-Path $DataDir "signage.sqlite")) { $existingDataDetected = $true }
if (Test-Path -LiteralPath (Join-Path $DataDir ".env")) { $existingDataDetected = $true }
if ($previousDataDir -and (Test-Path -LiteralPath (Join-Path $previousDataDir "signage.sqlite"))) {
    $existingDataDetected = $true
}

if (-not $TaskName) {
    $TaskName = if ($previousConfig -and $previousConfig.taskName) { [string]$previousConfig.taskName } else { "GugakSignage-Watchdog" }
}
if (-not $FirewallRuleName) {
    $FirewallRuleName = if ($previousConfig -and $previousConfig.firewallRuleName) { [string]$previousConfig.firewallRuleName } else { "GugakSignage-Server" }
}
if (-not $ProfileDir) {
    $ProfileDir = if ($previousConfig -and $previousConfig.profileDir) {
        [string]$previousConfig.profileDir
    } else {
        Join-Path $env:LOCALAPPDATA "GugakSignagePlayer"
    }
}
$ProfileDir = Get-NormalizedPath -Path $ProfileDir

$previousShortcuts = @()
if ($previousConfig -and $previousConfig.shortcuts -and -not $dataDirChanged) {
    $previousShortcuts = @($previousConfig.shortcuts | ForEach-Object { [string]$_ })
}
$previousAdminShortcuts = @()
if ($previousConfig -and $previousConfig.adminShortcuts -and -not $dataDirChanged) {
    $previousAdminShortcuts = @($previousConfig.adminShortcuts | ForEach-Object { [string]$_ })
}
if ($DesktopDir -or $StartMenuDir -or $previousShortcuts.Count -lt 2) {
    if (-not $DesktopDir) { $DesktopDir = [Environment]::GetFolderPath("Desktop") }
    if (-not $StartMenuDir) {
        $StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\열린안내판"
    }
    $shortcutPaths = @(
        (Join-Path (Get-NormalizedPath -Path $DesktopDir) "열린안내판.lnk"),
        (Join-Path (Get-NormalizedPath -Path $StartMenuDir) "열린안내판.lnk")
    )
    $adminShortcutPaths = @(
        (Join-Path (Get-NormalizedPath -Path $DesktopDir) "열린안내판 관리자.lnk"),
        (Join-Path (Get-NormalizedPath -Path $StartMenuDir) "열린안내판 관리자.lnk")
    )
} else {
    $shortcutPaths = @($previousShortcuts | ForEach-Object { Join-Path (Split-Path -Parent $_) "열린안내판.lnk" })
    $adminShortcutPaths = if ($previousAdminShortcuts.Count -eq 2) {
        @($previousAdminShortcuts | ForEach-Object { Join-Path (Split-Path -Parent $_) "열린안내판 관리자.lnk" })
    } else {
        @(
            (Join-Path (Split-Path -Parent $previousShortcuts[0]) "열린안내판 관리자.lnk"),
            (Join-Path (Split-Path -Parent $previousShortcuts[1]) "열린안내판 관리자.lnk")
        )
    }
}

$roleChanged = $previousConfig -and $roleExplicit -and ([string]$previousConfig.role -ne $watchdogRole)
if ($roleChanged -and $dataDirChanged) { throw "Role changes cannot be combined with a data-folder change." }
if ($Role -eq "manager") { $shortcutPaths = @(); $adminShortcutPaths = @($adminShortcutPaths) }
if ($Role -eq "player") {
    $shortcutPaths = @($shortcutPaths | ForEach-Object { Join-Path (Split-Path -Parent $_) "열린안내판 재생기.lnk" })
    $adminShortcutPaths = @()
}

if (-not $LogDir) {
    $LogDir = if ($previousConfig -and $previousConfig.logDir -and -not $dataDirChanged) {
        [string]$previousConfig.logDir
    } else {
        Join-Path $DataDir "logs"
    }
}
$LogDir = Get-NormalizedPath -Path $LogDir

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $DataDir "control") -Force | Out-Null
$stamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
$script:InstallLogPath = Join-Path $LogDir "install-$stamp.log"
Start-Transcript -LiteralPath $script:InstallLogPath -Append | Out-Null
$script:TranscriptStarted = $true

try {
    Write-Step "설치 시작"
    Write-Step "설치 폴더: $InstallDir"
    Write-Step "데이터 폴더: $DataDir"
    if ($previousDataDir) {
        Write-Step "기존 데이터 경로를 기본값으로 사용: $previousDataDir"
    }
    if ($dataDirChanged) {
        Write-Step "명시 확인에 따라 데이터 경로 변경: $previousDataDir -> $DataDir"
    }

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task -and -not (Test-ScheduledTaskOwnedByInstall -Task $task -InstallDir $InstallDir)) {
        throw "같은 이름의 다른 작업 스케줄러 항목이 있습니다. 덮어쓰지 않았습니다: $TaskName"
    }
    foreach ($shortcutPath in $shortcutPaths) {
        if (-not (Test-ShortcutOwnedByInstall -ShortcutPath $shortcutPath -InstallDir $InstallDir)) {
            throw "기존 GugakSignage 바로가기가 이 설치의 것이 아닙니다. 덮어쓰지 않았습니다: $shortcutPath"
        }
    }
    foreach ($adminShortcutPath in $adminShortcutPaths) {
        if (-not (Test-AdminShortcutOwnedByInstall -ShortcutPath $adminShortcutPath -InstallDir $InstallDir)) {
            throw "기존 GugakSignage 관리자 바로가기가 이 설치의 것이 아닙니다. 덮어쓰지 않았습니다: $adminShortcutPath"
        }
    }

    if (-not $NodePath) {
        $nodeCommand = Get-Command "node.exe" -ErrorAction SilentlyContinue
        if (-not $nodeCommand) {
            throw "Node.js 24 이상을 찾지 못했습니다. https://nodejs.org/ 에서 LTS 또는 24 이상을 설치한 뒤 다시 실행하세요."
        }
        $NodePath = $nodeCommand.Source
    }
    $NodePath = (Resolve-Path -LiteralPath $NodePath).Path
    $nodeVersion = (& $NodePath --version).Trim()
    $nodeMajor = [int](($nodeVersion.TrimStart("v") -split "\.")[0])
    if ($nodeMajor -lt 24) {
        throw "Node.js 24 이상이 필요합니다. 현재 버전: $nodeVersion"
    }
    Write-Step "Node.js 확인: $nodeVersion"

    if (-not $BrowserPath) { $BrowserPath = Find-Browser }
    $BrowserPath = (Resolve-Path -LiteralPath $BrowserPath).Path
    Write-Step "재생 브라우저: $BrowserPath"

    if (-not $SourceDir) {
        $packagedApp = Join-Path $PSScriptRoot "..\app"
        $SourceDir = if (Test-Path -LiteralPath (Join-Path $packagedApp "dist\server.js")) {
            $packagedApp
        } else {
            Join-Path $PSScriptRoot ".."
        }
    }
    $SourceDir = Get-NormalizedPath -Path $SourceDir

    if (-not $ConfigureOnly) {
        $required = @(
            (Join-Path $SourceDir "dist\server.js"),
            (Join-Path $SourceDir "package.json"),
            (Join-Path $SourceDir "public"),
            (Join-Path $SourceDir "poc\packages\engine\index.js"),
            (Join-Path $SourceDir "seed"),
            (Join-Path $SourceDir "node_modules")
        )
        foreach ($item in $required) {
            if (-not (Test-Path -LiteralPath $item)) {
                throw "설치 패키지가 불완전합니다: $item. build-installer.ps1로 패키지를 만든 뒤 실행하세요."
            }
        }
        if (Test-PathEqual -Left $SourceDir -Right $InstallDir) {
            throw "원본과 설치 폴더가 같습니다. 별도 설치 폴더를 지정하세요."
        }
        Write-Step "서버 파일 복사"
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        foreach ($directory in @("dist", "public", "poc\packages\engine", "seed", "node_modules")) {
            Copy-DirectoryContents -Source (Join-Path $SourceDir $directory) -Destination (Join-Path $InstallDir $directory)
        }
        foreach ($file in @("package.json", "package-lock.json", "LICENSE", "NOTICE")) {
            $sourceFile = Join-Path $SourceDir $file
            if (Test-Path -LiteralPath $sourceFile) {
                Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $InstallDir $file) -Force
            }
        }
        Copy-DirectoryContents -Source (Join-Path $PSScriptRoot "ops") -Destination (Join-Path $InstallDir "ops")
    } elseif (-not (Test-Path -LiteralPath (Join-Path $InstallDir "ops\watchdog.mjs"))) {
        throw "ConfigureOnly 실행에 필요한 ops\watchdog.mjs가 없습니다."
    }

    $toolsDir = Join-Path $InstallDir "tools"
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
    foreach ($tool in @("install.ps1", "uninstall.ps1", "set-autostart.ps1")) {
        $sourceTool = Join-Path $PSScriptRoot $tool
        $destinationTool = Join-Path $toolsDir $tool
        if ((Test-Path -LiteralPath $sourceTool) -and -not (Test-PathEqual -Left $sourceTool -Right $destinationTool)) {
            Copy-Item -LiteralPath $sourceTool -Destination $destinationTool -Force
        }
    }
    $installedOpsDir = Join-Path $InstallDir "ops"
    New-Item -ItemType Directory -Path $installedOpsDir -Force | Out-Null
    foreach ($opsFile in @("admin-launch.vbs", "open-admin.ps1", "admin-startup.mjs", "player-state.mjs", "player-adoption.mjs")) {
        $destination = Join-Path $installedOpsDir $opsFile
        if (Test-Path -LiteralPath $destination -PathType Leaf) { continue }
        $candidates = @(
            (Join-Path $PSScriptRoot "ops\$opsFile"),
            (Join-Path $PSScriptRoot "..\ops\$opsFile")
        )
        if ($SourceDir) {
            $candidates += @(
                (Join-Path $SourceDir "installer\ops\$opsFile"),
                (Join-Path $SourceDir "ops\$opsFile")
            )
        }
        $source = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
        if (-not $source) {
            throw "운영 도구를 찾지 못했습니다: ops\$opsFile. 설치 패키지를 다시 준비하세요."
        }
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }

    $envFile = Join-Path $DataDir ".env"
    $legacyEnvFile = Join-Path $InstallDir ".env"
    $copiedLegacyEnv = $false
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf) -and
        (Test-Path -LiteralPath $legacyEnvFile -PathType Leaf)) {
        Copy-EnvironmentFilePreservingAcl -Source $legacyEnvFile -Destination $envFile
        $copiedLegacyEnv = $true
        Write-Step "legacy 환경 설정을 데이터 폴더로 복사하고 원본을 보존"
    }
    if (-not (Test-Path -LiteralPath $envFile)) {
        Write-Step "환경 설정과 임의 비밀번호 생성"
        $adminPassword = "0000"
        $sessionSecret = New-RandomSecret -ByteCount 48
        $dataDirEnv = $DataDir.Replace('"', '\"')
        $seedSamples = if ($existingDataDetected) { "false" } else { "true" }
        $lines = @(
            "# Generated by GugakSignage installer. Do not commit this file.",
            [string]::Concat("ADMIN_PASSWORD=", $adminPassword),
            [string]::Concat("SESSION_SECRET=", $sessionSecret),
            [string]::Concat("PORT=", $Port),
            $(if ($Role -eq "player" -or ($Role -eq "manager" -and $Mode -eq "standalone")) { "HOST=127.0.0.1" } else { "HOST=0.0.0.0" }),
            "GUGAK_ROLE=$Role",
            "GUGAK_MODE=$Mode",
            [string]::Concat('DATA_DIR="', $dataDirEnv, '"'),
            [string]::Concat('DB_PATH="', (Join-Path $DataDir "signage.sqlite").Replace('"', '\"'), '"'),
            [string]::Concat('UPLOAD_DIR="', (Join-Path $DataDir "uploads").Replace('"', '\"'), '"'),
            "MAX_UPLOAD_MB=300",
            [string]::Concat("SEED_SAMPLES=", $seedSamples)
        )
        [IO.File]::WriteAllLines($envFile, [string[]]$lines, [Text.UTF8Encoding]::new($false))
        Protect-EnvironmentFile -Path $envFile
        Write-Step "경고: 테스트 기본 비밀번호 0000 · 설정에서 변경 필요"
    } else {
        $existingEnv = [IO.File]::ReadAllText($envFile, [Text.UTF8Encoding]::new($false, $true))
        if ($existingEnv -match "(?m)^ADMIN_PASSWORD=gugak1234\s*$" -or
            $existingEnv -match "(?m)^SESSION_SECRET=change-this-to-a-long-random-string\s*$") {
            throw "기존 .env에 개발용 기본 비밀값이 있습니다. 파일을 보존한 상태로 관리자 비밀번호와 세션 시크릿을 교체한 뒤 다시 설치하세요."
        }
        $existingPort = Get-EnvValue -EnvFile $envFile -Name "PORT"
        if ($existingPort) {
            $Port = [int]$existingPort
            Write-Step "기존 환경 설정 보존: PORT=$Port"
        } else {
            Write-Step "기존 환경 설정 보존"
        }
    }

    $writeModeEnv = ($Role -ne "all") -or $roleExplicit -or ($previousConfig -and ([string]$previousConfig.role -ne "integrated"))
    if ($writeModeEnv) {
        Set-EnvSetting -Path $envFile -Name "GUGAK_ROLE" -Value $Role
        Set-EnvSetting -Path $envFile -Name "GUGAK_MODE" -Value $Mode
    }
    if ($Role -eq "manager" -and $Mode -eq "lan") {
        Set-EnvSetting -Path $envFile -Name "HOST" -Value "0.0.0.0"
        Set-EnvSetting -Path $envFile -Name "GUGAK_TLS_CERT_FILE" -Value $TlsCertFile
        Set-EnvSetting -Path $envFile -Name "GUGAK_TLS_KEY_FILE" -Value $TlsKeyFile
        Set-EnvSetting -Path $envFile -Name "GUGAK_MANAGER_BASE_URL" -Value $ManagerBaseUrl
    } elseif ($Role -eq "manager" -and $Mode -eq "standalone") {
        Set-EnvSetting -Path $envFile -Name "HOST" -Value "127.0.0.1"
    } elseif ($Role -eq "player") {
        Set-EnvSetting -Path $envFile -Name "HOST" -Value "127.0.0.1"
        Set-EnvSetting -Path $envFile -Name "GUGAK_PLAYER_HOST_PORT" -Value "43127"
        if ($ManagerUrl) { Set-EnvSetting -Path $envFile -Name "GUGAK_MANAGER_URL" -Value $ManagerUrl }
        if ($ManagerCaFile) { Set-EnvSetting -Path $envFile -Name "GUGAK_TLS_CA_FILE" -Value $ManagerCaFile }
    }
    if ($Role -eq "manager" -and $Mode -eq "lan") {
        $managerBaseUri = [Uri]$ManagerBaseUrl
        if ($managerBaseUri.Port -ne $Port) { throw "Manager HTTPS base URL port must match the effective listener port from the preserved .env." }
    }

    if ($Role -eq "player") {
        $requiredPlayerUrl = "http://127.0.0.1:43127/player/"
        if ($PlayerUrl -and $PlayerUrl -ne $requiredPlayerUrl) { throw "Player Host must use $requiredPlayerUrl." }
        $PlayerUrl = $requiredPlayerUrl
    } elseif (-not $PlayerUrl) {
        $PlayerUrl = if ($previousConfig -and $previousConfig.playerUrl) {
            [string]$previousConfig.playerUrl
        } else {
            "http://127.0.0.1:$Port/player/?code=GUGAK1&reconnect=1"
        }
    }
    if ($DebugPort -le 0) {
        $DebugPort = if ($previousConfig -and $previousConfig.debugPort) { [int]$previousConfig.debugPort } else { Find-DebugPort }
    }

    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
    $launcherLines = @(
        'Option Explicit',
        'Dim shell, nodeExe, watchdog',
        'Set shell = CreateObject("WScript.Shell")',
        [string]::Concat('nodeExe = "', $NodePath, '"'),
        [string]::Concat('watchdog = "', (Join-Path $InstallDir "ops\watchdog.mjs"), '"'),
        'shell.Run Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & watchdog & Chr(34), 0, False'
    )
    Set-Content -LiteralPath (Join-Path $InstallDir "ops\watchdog-launch.vbs") -Value $launcherLines -Encoding ascii

    foreach ($shortcutPath in $shortcutPaths) {
        if (-not (Test-ShortcutOwnedByInstall -ShortcutPath $shortcutPath -InstallDir $InstallDir)) {
            throw "기존 바로가기가 이 설치의 것이 아닙니다. 덮어쓰지 않았습니다: $shortcutPath"
        }
        $null = New-Shortcut -ShortcutPath $shortcutPath -Description "열린안내판 서버와 관리자 페이지를 시작합니다."
    }
    if ($adminShortcutPaths.Count -gt 0 -and -not (Test-Path -LiteralPath (Join-Path $InstallDir "ops\admin-launch.vbs") -PathType Leaf)) {
        throw "관리자 실행 파일이 없습니다. 설치 패키지를 다시 준비하세요: ops\admin-launch.vbs"
    }
    foreach ($adminShortcutPath in $adminShortcutPaths) {
        $null = New-AdminShortcut -ShortcutPath $adminShortcutPath -Description "열린안내판 관리자 페이지를 기본 브라우저로 엽니다."
    }
    Write-Step "바탕화면·시작 메뉴 바로가기 생성"

    if ($OpenFirewall) {
        if (-not $isAdmin) {
            throw "방화벽 규칙 생성에는 관리자 PowerShell이 필요합니다. -OpenFirewall 없이 다시 실행하거나 관리자로 실행하세요."
        }
        $existingRule = Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue
        if ($existingRule) {
            $description = [string]$existingRule.Description
            if (-not $description.Contains("GugakSignage installer")) {
                throw "같은 이름의 다른 방화벽 규칙이 있습니다. -FirewallRuleName으로 다른 이름을 지정하세요: $FirewallRuleName"
            }
            Remove-NetFirewallRule -DisplayName $FirewallRuleName
        }
        New-NetFirewallRule -DisplayName $FirewallRuleName -Description "GugakSignage installer; installDir=$InstallDir" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Program $NodePath -Profile Private, Domain | Out-Null
        Write-Step "방화벽 인바운드 규칙 생성: TCP $Port"
    }

    $autoStartRegistered = $false
    if (-not $NoAutoStart) {
        Register-WatchdogTask
        $autoStartRegistered = $true
        Write-Step "작업 스케줄러 자동 실행 등록: $TaskName"
    } else {
        $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        $autoStartRegistered = [bool]($existingTask -and $existingTask.State -ne "Disabled")
    }

    Write-InstallConfig -ConfigPath $configPath -Shortcuts $shortcutPaths -AdminShortcuts $adminShortcutPaths -AdminAutoOpenEnabled $adminAutoOpenEnabled -PreviousConfig $previousConfig -AutoStartRegistered $autoStartRegistered -WatchdogRole $watchdogRole

    # Remove only recorded legacy links owned by this installation, after new links and config exist.
    if ($previousConfig) {
        foreach ($oldPath in @($previousConfig.shortcuts)) {
            if ($oldPath -and $shortcutPaths -notcontains [string]$oldPath -and
                (Test-Path -LiteralPath $oldPath -PathType Leaf) -and
                (Test-ShortcutOwnedByInstall -ShortcutPath $oldPath -InstallDir $InstallDir)) { Remove-Item -LiteralPath $oldPath -Force }
        }
        foreach ($oldPath in @($previousConfig.adminShortcuts)) {
            if ($oldPath -and $adminShortcutPaths -notcontains [string]$oldPath -and
                (Test-Path -LiteralPath $oldPath -PathType Leaf) -and
                (Test-AdminShortcutOwnedByInstall -ShortcutPath $oldPath -InstallDir $InstallDir)) { Remove-Item -LiteralPath $oldPath -Force }
        }
        foreach ($legacyPath in @($previousConfig.shortcuts)) {
            if ($legacyPath -and [IO.Path]::GetFileName([string]$legacyPath) -eq "GugakSignage.lnk" -and
                (Test-Path -LiteralPath $legacyPath -PathType Leaf) -and
                (Test-ShortcutOwnedByInstall -ShortcutPath $legacyPath -InstallDir $InstallDir)) {
                Remove-Item -LiteralPath $legacyPath -Force
            }
        }
        foreach ($legacyPath in @($previousConfig.adminShortcuts)) {
            if ($legacyPath -and [IO.Path]::GetFileName([string]$legacyPath) -eq "GugakSignage 관리자.lnk" -and
                (Test-Path -LiteralPath $legacyPath -PathType Leaf) -and
                (Test-AdminShortcutOwnedByInstall -ShortcutPath $legacyPath -InstallDir $InstallDir)) {
                Remove-Item -LiteralPath $legacyPath -Force
            }
        }
    }


    if (-not $NoStart) {
        if (-not $NoAutoStart) {
            Start-ScheduledTask -TaskName $TaskName
        } else {
            $launchArgs = @{
                FilePath = (Join-Path $env:SystemRoot "System32\wscript.exe")
                ArgumentList = @("//B", "//NoLogo", (Join-Path $InstallDir "ops\watchdog-launch.vbs"))
                WorkingDirectory = $InstallDir
                WindowStyle = "Hidden"
            }
            Start-Process @launchArgs
        }
        Write-Step "watchdog 시작 후 서버 상태 확인"
        if (-not (Wait-ServerHealth -TimeoutSeconds 150)) {
            $watchdogLog = Join-Path $LogDir "watchdog.log"
            $tail = if (Test-Path -LiteralPath $watchdogLog) {
                (Get-Content -LiteralPath $watchdogLog -Tail 30) -join [Environment]::NewLine
            } else {
                "watchdog.log가 아직 생성되지 않았습니다."
            }
            throw "서버가 150초 안에 준비되지 않았습니다.$([Environment]::NewLine)$tail"
        }
        $healthUrl = if ($watchdogRole -eq "manager" -and $Mode -eq "lan") { $ManagerBaseUrl.TrimEnd('/') + "/api/health" } elseif ($watchdogRole -eq "player-host") { "http://127.0.0.1:43127/api/health" } else { "http://127.0.0.1:$Port/api/health" }
        Write-Step "서버 준비 완료: $healthUrl"
    }

    Write-Step "설치 완료"
    Write-Step "경고: 테스트 기본 비밀번호 0000 · 설정에서 변경 필요"
    if ($Role -eq "player") {
        Write-Step "재생기 화면: $PlayerUrl"
        Write-Step "중앙 Manager: $ManagerUrl"
    } else {
        $adminUrl = if ($Role -eq "manager" -and $Mode -eq "lan") { $ManagerBaseUrl.TrimEnd('/') + "/admin/" } else { "http://127.0.0.1:$Port/admin/" }
        Write-Step "관리자 화면: $adminUrl"
        Write-Step "관리자 바로가기: $($adminShortcutPaths -join ', ')"
        Write-Step "관리자 페이지 자동 열기: $(if ($adminAutoOpenEnabled) { '사용' } else { '사용 안 함' })"
    }
    Write-Step "초기 비밀번호: $envFile 의 ADMIN_PASSWORD (로그에는 기록하지 않음)"
    Write-Step "설치 로그: $script:InstallLogPath"
    Write-Step "watchdog 로그: $(Join-Path $LogDir "watchdog.log")"
} catch {
    Write-Host "[GugakSignage] 설치 실패: $($_.Exception.Message)" -ForegroundColor Red
    throw
} finally {
    if ($script:TranscriptStarted) {
        Stop-Transcript | Out-Null
    }
}
