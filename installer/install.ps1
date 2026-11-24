# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$SourceDir = "",
    [string]$InstallDir = "",
    [string]$DataDir = "",
    [int]$Port = 3000,
    [string]$PlayerUrl = "",
    [string]$BrowserPath = "",
    [string]$NodePath = "",
    [string]$TaskName = "GugakSignage-Watchdog",
    [string]$FirewallRuleName = "GugakSignage-Server",
    [string]$DesktopDir = "",
    [string]$StartMenuDir = "",
    [string]$ProfileDir = "",
    [string]$LogDir = "",
    [int]$DebugPort = 0,
    [switch]$OpenFirewall,
    [switch]$NoAutoStart,
    [switch]$NoStart,
    [switch]$ConfigureOnly
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
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

function Get-EnvPort {
    param([string]$EnvFile)
    if (-not (Test-Path -LiteralPath $EnvFile)) { return $null }
    $line = Get-Content -LiteralPath $EnvFile |
        Where-Object { $_ -match "^\s*PORT\s*=\s*(\d+)\s*$" } |
        Select-Object -First 1
    if (-not $line) { return $null }
    $null = $line -match "(\d+)"
    return [int]$Matches[1]
}

function Protect-EnvironmentFile {
    param([string]$Path)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path /inheritance:r /grant:r "*${sid}:(R,W)" "*S-1-5-18:(F)" "*S-1-5-32-544:(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "환경 설정 파일의 ACL을 보호하지 못했습니다: $Path"
    }
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
        [string[]]$Shortcuts
    )
    $config = [ordered]@{
        schemaVersion       = 1
        product             = "GugakSignage"
        installDir          = $InstallDir
        dataDir             = $DataDir
        envFile             = $envFile
        logDir              = $LogDir
        port                = $Port
        playerUrl           = $PlayerUrl
        browserPath         = $BrowserPath
        nodePath            = $NodePath
        profileDir          = $ProfileDir
        taskName            = $TaskName
        firewallRuleName    = $FirewallRuleName
        debugPort           = $DebugPort
        shortcuts           = $Shortcuts
        autoStartRegistered = -not $NoAutoStart
        updatedAt           = [DateTime]::UtcNow.ToString("o")
        watchdog            = [ordered]@{
            healthIntervalMs         = 5000
            browserCheckIntervalMs   = 15000
            startupGraceMs           = 45000
            serverBackoffInitialMs   = 2000
            serverBackoffMaxMs       = 60000
            browserBackoffInitialMs  = 3000
            browserBackoffMaxMs      = 60000
            circuitBreakerAfter      = 8
            circuitBreakerCooldownMs = 300000
            stableResetMs            = 60000
        }
    }
    $json = $config | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($ConfigPath, $json, [Text.UTF8Encoding]::new($false))
}

function New-Shortcut {
    param(
        [string]$ShortcutPath,
        [string]$Description
    )
    $parent = Split-Path -Parent $ShortcutPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
    $shortcut.Arguments = '//B //NoLogo "' + (Join-Path $InstallDir "ops\watchdog-launch.vbs") + '"'
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.Description = $Description
    $shortcut.IconLocation = "$BrowserPath,0"
    $shortcut.Save()
    return $ShortcutPath
}

function Register-WatchdogTask {
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
    param([int]$TimeoutSeconds = 60)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(2)
    try {
        while ([DateTime]::UtcNow -lt $deadline) {
            try {
                $content = $client.GetStringAsync("http://127.0.0.1:$Port/api/health").GetAwaiter().GetResult()
                $response = $content | ConvertFrom-Json
                if ($response.ok -and $response.service -eq "gugak-signage") { return $true }
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
if (-not $DataDir) {
    $DataDir = if ($isAdmin) {
        Join-Path $env:ProgramData "GugakSignage"
    } else {
        Join-Path $env:LOCALAPPDATA "GugakSignage"
    }
}
if (-not $DesktopDir) { $DesktopDir = [Environment]::GetFolderPath("Desktop") }
if (-not $StartMenuDir) {
    $StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\GugakSignage"
}
if (-not $ProfileDir) { $ProfileDir = Join-Path $env:LOCALAPPDATA "GugakSignagePlayer" }
if (-not $LogDir) { $LogDir = Join-Path $DataDir "logs" }

$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$DataDir = [IO.Path]::GetFullPath($DataDir)
$LogDir = [IO.Path]::GetFullPath($LogDir)
$DesktopDir = [IO.Path]::GetFullPath($DesktopDir)
$StartMenuDir = [IO.Path]::GetFullPath($StartMenuDir)
$ProfileDir = [IO.Path]::GetFullPath($ProfileDir)

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
    $SourceDir = [IO.Path]::GetFullPath($SourceDir)

    if (-not $ConfigureOnly) {
        $required = @(
            (Join-Path $SourceDir "dist\server.js"),
            (Join-Path $SourceDir "package.json"),
            (Join-Path $SourceDir "public"),
            (Join-Path $SourceDir "seed"),
            (Join-Path $SourceDir "node_modules")
        )
        foreach ($item in $required) {
            if (-not (Test-Path -LiteralPath $item)) {
                throw "설치 패키지가 불완전합니다: $item. build-installer.ps1로 패키지를 만든 뒤 실행하세요."
            }
        }
        if ([IO.Path]::GetFullPath($SourceDir).TrimEnd("\") -eq $InstallDir.TrimEnd("\")) {
            throw "원본과 설치 폴더가 같습니다. 별도 설치 폴더를 지정하세요."
        }
        Write-Step "서버 파일 복사"
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        foreach ($directory in @("dist", "public", "seed", "node_modules")) {
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
        if ((Test-Path -LiteralPath $sourceTool) -and ([IO.Path]::GetFullPath($sourceTool) -ne [IO.Path]::GetFullPath($destinationTool))) {
            Copy-Item -LiteralPath $sourceTool -Destination $destinationTool -Force
        }
    }

    $envFile = Join-Path $DataDir ".env"
    if (-not (Test-Path -LiteralPath $envFile)) {
        Write-Step "환경 설정과 임의 비밀번호 생성"
        $adminPassword = New-RandomSecret -ByteCount 18
        $sessionSecret = New-RandomSecret -ByteCount 48
        $dataDirEnv = $DataDir.Replace('"', '\"')
        $lines = @(
            "# Generated by GugakSignage installer. Do not commit this file.",
            [string]::Concat("ADMIN_PASSWORD=", $adminPassword),
            [string]::Concat("SESSION_SECRET=", $sessionSecret),
            [string]::Concat("PORT=", $Port),
            "HOST=0.0.0.0",
            [string]::Concat('DATA_DIR="', $dataDirEnv, '"'),
            [string]::Concat('DB_PATH="', (Join-Path $DataDir "signage.sqlite").Replace('"', '\"'), '"'),
            [string]::Concat('UPLOAD_DIR="', (Join-Path $DataDir "uploads").Replace('"', '\"'), '"'),
            "MAX_UPLOAD_MB=300",
            "SEED_SAMPLES=true"
        )
        Set-Content -LiteralPath $envFile -Value $lines -Encoding utf8
        Protect-EnvironmentFile -Path $envFile
    } else {
        $existingEnv = Get-Content -LiteralPath $envFile -Raw
        if ($existingEnv -match "(?m)^ADMIN_PASSWORD=gugak1234\\s*$" -or
            $existingEnv -match "(?m)^SESSION_SECRET=change-this-to-a-long-random-string\\s*$") {
            throw "기존 .env에 개발용 기본 비밀값이 있습니다. 파일을 보존한 상태로 관리자 비밀번호와 세션 시크릿을 교체한 뒤 다시 설치하세요."
        }
        $existingPort = Get-EnvPort -EnvFile $envFile
        if ($existingPort) {
            $Port = $existingPort
            Write-Step "기존 환경 설정 보존: PORT=$Port"
        } else {
            Write-Step "기존 환경 설정 보존"
        }
    }

    if (-not $PlayerUrl) {
        $PlayerUrl = "http://127.0.0.1:$Port/player/?code=GUGAK1&reconnect=1"
    }
    if ($DebugPort -le 0) { $DebugPort = Find-DebugPort }

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

    $shortcutPaths = @(
        (Join-Path $DesktopDir "GugakSignage.lnk"),
        (Join-Path $StartMenuDir "GugakSignage.lnk")
    )
    foreach ($shortcutPath in $shortcutPaths) {
        $null = New-Shortcut -ShortcutPath $shortcutPath -Description "GugakSignage 서버와 전체 화면 재생기를 시작합니다."
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

    $configPath = Join-Path $InstallDir "install.json"
    Write-InstallConfig -ConfigPath $configPath -Shortcuts $shortcutPaths

    if (-not $NoAutoStart) {
        Register-WatchdogTask
        Write-Step "작업 스케줄러 자동 실행 등록: $TaskName"
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
        if (-not (Wait-ServerHealth -TimeoutSeconds 60)) {
            $watchdogLog = Join-Path $LogDir "watchdog.log"
            $tail = if (Test-Path -LiteralPath $watchdogLog) {
                (Get-Content -LiteralPath $watchdogLog -Tail 20) -join [Environment]::NewLine
            } else {
                "watchdog.log가 아직 생성되지 않았습니다."
            }
            throw "서버가 60초 안에 준비되지 않았습니다.$([Environment]::NewLine)$tail"
        }
        Write-Step "서버 준비 완료: http://127.0.0.1:$Port/api/health"
    }

    Write-Step "설치 완료"
    Write-Step "관리자 화면: http://127.0.0.1:$Port/admin/"
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
