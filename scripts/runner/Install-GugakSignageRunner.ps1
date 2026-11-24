[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('ValidateOnly', 'InstallService')]
    [string]$Mode,

    [switch]$Elevate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$owner = 'toxicyou25-afk'
$repository = 'GugakSignage'
$repositoryUrl = "https://github.com/$owner/$repository"
$runnerName = 'GugakSignage-CI-Win11'
$runnerLabel = 'gugaksignage-ci'
$runnerVersion = '2.338.2'
$runnerSha256 = 'a1f17aa987fc8158bc7521d284912267a0d01b7c2c4684b33c86783b5e8221cc'
$runnerRoot = 'C:\actions-runners\GugakSignage'
$runnerDirectory = Join-Path $runnerRoot 'runner'
$archive = Join-Path $runnerRoot "_download\actions-runner-win-x64-$runnerVersion.zip"
$temporaryDirectory = Join-Path $runnerRoot '_temp'
$toolCacheDirectory = Join-Path $runnerRoot '_toolcache'
$npmCacheDirectory = Join-Path $runnerRoot '_cache\npm'
$playwrightCacheDirectory = Join-Path $runnerRoot '_cache\ms-playwright'
$homeDirectory = Join-Path $runnerRoot 'home'
$admissionDirectory = Join-Path $runnerRoot 'admission'
$admissionHook = Join-Path $admissionDirectory 'Assert-TrustedJob.ps1'

function Assert-RunnerRootIsIsolated {
    $fullRunnerRoot = [IO.Path]::GetFullPath($runnerRoot).TrimEnd('\')
    $userProfile = [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\')
    if ($fullRunnerRoot.StartsWith("$userProfile\", [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The runner root must stay outside the current user profile and all user checkouts.'
    }
}

function Test-IsElevated {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-MachineGitDirectory {
    $gitCommand = Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $gitDirectory = Split-Path -Parent $gitCommand.Source
    $userProfile = [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\')
    if ($gitDirectory.StartsWith("$userProfile\", [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Git must be installed outside the current user profile so the LocalService runner can use it.'
    }
    return $gitDirectory
}

function Set-RunnerRootPermissions {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'

    # Reset only files below the dedicated runner root so protected empty or
    # stale DACLs cannot block cached runner data or admission installation.
    # /reset changes ACLs only; existing files and directories remain intact.
    & $icacls $runnerRoot '/reset' '/T' '/Q' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not reset stale ACLs below C:\actions-runners\GugakSignage.'
    }

    $arguments = @(
        $runnerRoot,
        '/inheritance:r',
        '/grant:r',
        "$identity`:(OI)(CI)F",
        'NT AUTHORITY\SYSTEM:(OI)(CI)F',
        'BUILTIN\Administrators:(OI)(CI)F',
        'NT AUTHORITY\LOCAL SERVICE:(OI)(CI)M'
    )
    & $icacls @arguments | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not apply the runner-only ACL to C:\actions-runners\GugakSignage.'
    }
}

function Reset-IsolatedAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Cannot repair the ACL because the path does not exist: $Path"
    }
    $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
    & $icacls $Path /reset | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not restore the dedicated runner ACL on: $Path"
    }
}

function Repair-AdmissionAcl {
    if (Test-Path -LiteralPath $admissionDirectory) {
        Reset-IsolatedAcl -Path $admissionDirectory
    }
    if (Test-Path -LiteralPath $admissionHook) {
        Reset-IsolatedAcl -Path $admissionHook
    }
}

function Ensure-RunnerFiles {
    foreach ($directory in @(
        $runnerRoot,
        $runnerDirectory,
        (Join-Path $runnerRoot '_download'),
        (Join-Path $runnerRoot '_work'),
        $temporaryDirectory,
        $toolCacheDirectory,
        $npmCacheDirectory,
        $playwrightCacheDirectory,
        (Join-Path $runnerRoot '_logs'),
        $admissionDirectory,
        (Join-Path $homeDirectory 'AppData\Roaming'),
        (Join-Path $homeDirectory 'AppData\Local')
    )) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    if (-not (Test-Path -LiteralPath (Join-Path $runnerDirectory 'config.cmd'))) {
        if (-not (Test-Path -LiteralPath $archive)) {
            $downloadUrl = "https://github.com/actions/runner/releases/download/v$runnerVersion/actions-runner-win-x64-$runnerVersion.zip"
            Invoke-WebRequest -Uri $downloadUrl -OutFile $archive -UseBasicParsing
        }

        $actualSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualSha256 -ne $runnerSha256) {
            throw "The GitHub Actions runner package checksum did not match the pinned release digest."
        }

        Expand-Archive -LiteralPath $archive -DestinationPath $runnerDirectory -Force
    }

    if (-not (Test-Path -LiteralPath (Join-Path $runnerDirectory 'run.cmd'))) {
        throw 'The downloaded runner package is missing run.cmd.'
    }

    $hookSource = Join-Path $PSScriptRoot 'Assert-TrustedJob.ps1'
    if (-not (Test-Path -LiteralPath $hookSource)) {
        throw 'The repository runner admission hook is missing from scripts/runner.'
    }
    Repair-AdmissionAcl
    Copy-Item -LiteralPath $hookSource -Destination $admissionHook -Force
    Reset-IsolatedAcl -Path $admissionHook
}

function Set-ServiceProcessEnvironment {
    param([Parameter(Mandatory = $true)][string]$ServiceName)

    $gitDirectory = Get-MachineGitDirectory
    $windowsDirectory = [Environment]::GetEnvironmentVariable('SystemRoot', 'Machine')
    if ([string]::IsNullOrWhiteSpace($windowsDirectory)) {
        $windowsDirectory = $env:SystemRoot
    }

    $safePath = @(
        (Join-Path $windowsDirectory 'System32'),
        $windowsDirectory,
        (Join-Path $windowsDirectory 'System32\Wbem'),
        $gitDirectory
    ) -join ';'

    $environmentEntries = [Collections.Generic.List[string]]::new()
    foreach ($entry in @(
        "PATH=$safePath",
        "SystemRoot=$windowsDirectory",
        "windir=$windowsDirectory",
        "ComSpec=$(Join-Path $windowsDirectory 'System32\cmd.exe')",
        'PATHEXT=.COM;.EXE;.BAT;.CMD',
        "TEMP=$temporaryDirectory",
        "TMP=$temporaryDirectory",
        "USERPROFILE=$homeDirectory",
        "HOME=$homeDirectory",
        'HOMEDRIVE=C:',
        'HOMEPATH=\actions-runners\GugakSignage\home',
        "APPDATA=$(Join-Path $homeDirectory 'AppData\Roaming')",
        "LOCALAPPDATA=$(Join-Path $homeDirectory 'AppData\Local')",
        "RUNNER_TEMP=$temporaryDirectory",
        "RUNNER_TOOL_CACHE=$toolCacheDirectory",
        "NPM_CONFIG_CACHE=$npmCacheDirectory",
        "PLAYWRIGHT_BROWSERS_PATH=$playwrightCacheDirectory",
        "ACTIONS_RUNNER_HOOK_JOB_STARTED=$admissionHook",
        'GH_TOKEN=',
        'GITHUB_TOKEN=',
        'OPENAI_API_KEY=',
        'OPENROUTER_API_KEY=',
        'ORCA_AGENT_SESSION_SPAWN_TOKEN=',
        'ORCA_USER_DATA_PATH=',
        'CODEX_HOME='
    )) {
        $environmentEntries.Add($entry)
    }

    $machineEnvironment = [Environment]::GetEnvironmentVariables('Machine')
    foreach ($name in $machineEnvironment.Keys) {
        if ($name -match '(?i)(TOKEN|API.?KEY|SECRET|CREDENTIAL|ACCOUNT|ORCA|CODEX|TOSSPAPERLAB|DBRAINPLUS|PROD.*(ROOT|PATH)|(ROOT|PATH).*(PROD|TOSS|DBRAIN))') {
            $environmentEntries.Add("$name=")
        }
    }

    $serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
    if (-not (Test-Path -LiteralPath $serviceKey)) {
        throw "The runner service registry key was not found: $ServiceName"
    }
    New-ItemProperty -LiteralPath $serviceKey -Name Environment -PropertyType MultiString -Value $environmentEntries.ToArray() -Force | Out-Null
}

Assert-RunnerRootIsIsolated

if ($Elevate -and -not (Test-IsElevated)) {
    $childArguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', "`"$PSCommandPath`"",
        '-Mode', $Mode
    )
    $child = Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList $childArguments -Wait -PassThru
    if ($child.ExitCode -ne 0) {
        throw "The elevated runner installer exited with code $($child.ExitCode)."
    }
    exit 0
}

if ($Mode -eq 'ValidateOnly') {
    Ensure-RunnerFiles
    $archiveHash = if (Test-Path -LiteralPath $archive) { (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() } else { 'not-present' }
    if ($archiveHash -ne 'not-present' -and $archiveHash -ne $runnerSha256) {
        throw 'The cached runner archive checksum does not match the pinned release digest.'
    }
    $admissionTest = Join-Path $PSScriptRoot 'Test-GugakSignageRunnerAdmission.ps1'
    try {
        & $admissionTest -HookPath $admissionHook
    } catch {
        throw "Runner admission hook tests failed: $($_.Exception.Message)"
    }
    Write-Output "PASS: runner root, pinned release, isolated layout, and admission hook validated for $runnerName ($runnerLabel)."
    exit 0
}

if (-not (Test-IsElevated)) {
    throw 'InstallService requires an elevated PowerShell session. Use the one-command bootstrap in docs/operations/self-hosted-runner.md.'
}

if (Test-Path -LiteralPath (Join-Path $runnerDirectory '.runner')) {
    $serviceFile = Join-Path $runnerDirectory '.service'
    if (-not (Test-Path -LiteralPath $serviceFile)) {
        throw 'A runner is already configured without a service. Remove that local configuration before running InstallService.'
    }

    $existingServiceName = (Get-Content -LiteralPath $serviceFile -Raw).Trim()
    $existingService = Get-CimInstance Win32_Service -Filter "Name='$existingServiceName'" -ErrorAction SilentlyContinue
    if (-not $existingService) {
        throw 'Runner configuration exists but its Windows service is missing; remove and register it again before installing.'
    }

    if ($existingService.StartName -notmatch '(?i)LOCAL SERVICE') {
        throw 'The configured runner service does not use NT AUTHORITY\LOCAL SERVICE.'
    }

    New-Item -ItemType Directory -Path $runnerRoot -Force | Out-Null
    Set-RunnerRootPermissions
    Ensure-RunnerFiles
    Set-ServiceProcessEnvironment -ServiceName $existingServiceName
    Set-Service -Name $existingServiceName -StartupType Automatic
    if ($existingService.State -eq 'Running') {
        Stop-Service -Name $existingServiceName -Force
    }
    Start-Service -Name $existingServiceName
    Write-Output "PASS: $runnerName is running as NT AUTHORITY\LOCAL SERVICE with automatic startup."
    exit 0
}

$gh = Get-Command gh.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
& $gh.Source auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI must be authenticated as a repository administrator before installing the runner.'
}

New-Item -ItemType Directory -Path $runnerRoot -Force | Out-Null
Set-RunnerRootPermissions
Ensure-RunnerFiles

$registrationToken = & $gh.Source api --method POST "repos/$owner/$repository/actions/runners/registration-token" --jq '.token'
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($registrationToken)) {
    $registrationToken = $null
    throw 'GitHub did not return a runner registration token.'
}
$registrationToken = $registrationToken.Trim()

$configCommand = Join-Path $runnerDirectory 'config.cmd'
$configArguments = @(
    '--unattended',
    '--url', $repositoryUrl,
    '--token', $registrationToken,
    '--name', $runnerName,
    '--labels', $runnerLabel,
    '--work', '_work',
    '--runasservice',
    '--windowslogonaccount', 'NT AUTHORITY\LOCAL SERVICE'
)
$configOutput = & $configCommand @configArguments 2>&1
$configExitCode = $LASTEXITCODE
$registrationToken = $null
$configArguments = $null
$configOutput = $null
[GC]::Collect()
if ($configExitCode -ne 0) {
    throw "Runner service configuration failed with exit code $configExitCode. No command output or credentials were written by this script."
}

$serviceFile = Join-Path $runnerDirectory '.service'
if (-not (Test-Path -LiteralPath $serviceFile)) {
    throw 'Runner configuration completed but did not create the expected Windows service metadata.'
}
$serviceName = (Get-Content -LiteralPath $serviceFile -Raw).Trim()
Set-ServiceProcessEnvironment -ServiceName $serviceName
Set-Service -Name $serviceName -StartupType Automatic
if ((Get-Service -Name $serviceName).Status -eq 'Running') {
    Stop-Service -Name $serviceName -Force
}
Start-Service -Name $serviceName

$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if ($service.State -ne 'Running' -or $service.StartMode -ne 'Auto' -or $service.StartName -notmatch '(?i)LOCAL SERVICE') {
    throw 'The runner service did not reach the required running, automatic, LocalService state.'
}

Write-Output "PASS: $runnerName ($runnerLabel) is running as NT AUTHORITY\LOCAL SERVICE with automatic startup."
