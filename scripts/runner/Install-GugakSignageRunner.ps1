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
$admissionHookSource = Join-Path $PSScriptRoot 'Assert-TrustedJob.ps1'
$runnerExecutable = Join-Path $runnerDirectory 'bin\Runner.Listener.exe'
$configurationLauncher = Join-Path $PSScriptRoot 'Invoke-RunnerConfiguration.ps1'
$admissionTest = Join-Path $PSScriptRoot 'Test-GugakSignageRunnerAdmission.ps1'
$aclPolicyTest = Join-Path $PSScriptRoot 'Assert-RunnerAclPolicy.ps1'
$autoUpdateDisableScript = Join-Path $PSScriptRoot 'Set-RunnerAutoUpdateDisabled.ps1'
$serviceRecoveryScript = Join-Path $PSScriptRoot 'Set-RunnerServiceRecovery.ps1'
$serviceRecoveryTest = Join-Path $PSScriptRoot 'Assert-RunnerServiceRecovery.ps1'

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
        'NT AUTHORITY\LOCAL SERVICE:(OI)(CI)RX'
    )
    & $icacls @arguments | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not apply the runner-only ACL to C:\actions-runners\GugakSignage.'
    }
}

function Set-ExplicitDirectoryAccess {
    param([Parameter(Mandatory = $true)][string]$Path)

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) {
        $acl.RemoveAccessRuleAll($rule)
    }

    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $grants = @(
        [pscustomobject]@{ Identity = $identity; Rights = [Security.AccessControl.FileSystemRights]::FullControl },
        [pscustomobject]@{ Identity = 'NT AUTHORITY\SYSTEM'; Rights = [Security.AccessControl.FileSystemRights]::FullControl },
        [pscustomobject]@{ Identity = 'BUILTIN\Administrators'; Rights = [Security.AccessControl.FileSystemRights]::FullControl },
        [pscustomobject]@{ Identity = 'NT AUTHORITY\LOCAL SERVICE'; Rights = [Security.AccessControl.FileSystemRights]::Modify }
    )
    $seen = @{}
    foreach ($grant in $grants) {
        $key = $grant.Identity.ToLowerInvariant()
        if ($seen.ContainsKey($key)) {
            continue
        }
        $seen[$key] = $true
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $grant.Identity,
            $grant.Rights,
            $inheritance,
            $propagation,
            $allow
        ))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Set-RunnerWritablePermissions {
    $writableDirectories = @(
        (Join-Path $runnerRoot '_work'),
        $temporaryDirectory,
        $toolCacheDirectory,
        (Join-Path $runnerRoot '_cache'),
        (Join-Path $runnerRoot '_logs'),
        $homeDirectory,
        (Join-Path $runnerDirectory '_work'),
        (Join-Path $runnerDirectory '_diag')
    )
    $broadWriteSids = @('S-1-5-11', 'S-1-5-32-545', 'S-1-1-0')
    $localServiceSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::LocalServiceSid, $null)
    foreach ($directory in $writableDirectories) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        Set-ExplicitDirectoryAccess -Path $directory
        $acl = Get-Acl -LiteralPath $directory
        if (-not $acl.AreAccessRulesProtected) {
            throw "Runner runtime path still inherits broad ACLs: $directory"
        }
        $localServiceRules = @($acl.Access | Where-Object {
            $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            (($_.IdentityReference -is [Security.Principal.SecurityIdentifier] -and $_.IdentityReference -eq $localServiceSid) -or
             ($_.IdentityReference.Value -eq 'NT AUTHORITY\LOCAL SERVICE'))
        })
        if (-not ($localServiceRules | Where-Object { ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Modify) -eq [Security.AccessControl.FileSystemRights]::Modify })) {
            throw "LocalService lacks Modify access on runner runtime path: $directory"
        }
        foreach ($rule in $acl.Access) {
            $identityValue = if ($rule.IdentityReference -is [Security.Principal.SecurityIdentifier]) {
                $rule.IdentityReference.Value
            } else {
                $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            }
            if ($broadWriteSids -contains $identityValue -and
                (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Modify) -ne 0)) {
                throw "Broad identity has write access to runner runtime path: $directory"
            }
        }
    }
}

function Assert-RunnerAclPolicy {
    & $aclPolicyTest -RunnerRoot $runnerRoot
    if (-not $?) {
        throw 'The runner ACL policy validation failed.'
    }
}

function Invoke-AdmissionTests {
    try {
        & $admissionTest -HookPath $admissionHookSource
    } catch {
        throw "Runner admission hook tests failed: $($_.Exception.Message)"
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

    if (-not (Test-Path -LiteralPath $admissionHookSource)) {
        throw 'The repository runner admission hook is missing from scripts/runner.'
    }
    Repair-AdmissionAcl
    Copy-Item -LiteralPath $admissionHookSource -Destination $admissionHook -Force
    Reset-IsolatedAcl -Path $admissionHook
}

function Set-ServiceProcessEnvironment {
    param([Parameter(Mandatory = $true)][string]$ServiceName)

    $gitDirectory = Get-MachineGitDirectory
    $windowsDirectory = [Environment]::GetEnvironmentVariable('SystemRoot', 'Machine')
    if ([string]::IsNullOrWhiteSpace($windowsDirectory)) {
        $windowsDirectory = $env:SystemRoot
    }

    # The runner launches the job-started hook as "powershell"; keep the
    # Windows PowerShell directory on the service PATH after a restart.
    $safePath = @(
        (Join-Path $windowsDirectory 'System32'),
        (Join-Path $windowsDirectory 'System32\WindowsPowerShell\v1.0'),
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

function Set-RunnerAutoUpdateDisabled {
    $settingsFile = Join-Path $runnerDirectory '.runner'
    & $autoUpdateDisableScript -SettingsFile $settingsFile
    if (-not $?) {
        throw 'Runner auto-update configuration failed.'
    }
}

function Invoke-RunnerRegistrationWithSecret {
    param([Parameter(Mandatory = $true)][string]$RegistrationToken)

    if (-not (Test-Path -LiteralPath $configurationLauncher)) {
        throw 'The no-argv runner configuration launcher is missing.'
    }
    if (-not (Test-Path -LiteralPath $runnerExecutable)) {
        throw 'Runner.Listener.exe is missing from the pinned runner package.'
    }

    $payload = [ordered]@{
        executable = $runnerExecutable
        workingDirectory = $runnerDirectory
        arguments = @(
            'configure',
            '--url', $repositoryUrl,
            '--name', $runnerName,
            '--runnergroup', 'Default',
            '--labels', $runnerLabel,
            '--work', '_work',
            '--runasservice',
            '--windowslogonaccount', 'NT AUTHORITY\LOCAL SERVICE',
            '--disableupdate'
        )
    }
    $payloadJson = $payload | ConvertTo-Json -Compress -Depth 6
    $payloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payloadJson))

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = (Get-Command powershell.exe -CommandType Application | Select-Object -First 1).Source
    $startInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$configurationLauncher`" -PayloadBase64 $payloadBase64"
    $startInfo.WorkingDirectory = $PSScriptRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        $null = $process.Start()
        $process.StandardInput.WriteLine($RegistrationToken)
        $process.StandardInput.Close()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(310000)) {
            $process.Kill()
            throw 'Runner configuration exceeded the 310-second safety timeout.'
        }
        $null = $stdoutTask.Result
        $safeError = $stderrTask.Result.Replace($RegistrationToken, '[redacted]')
        if ($process.ExitCode -ne 0) {
            throw "Runner configuration failed with exit code $($process.ExitCode). $safeError"
        }
    } finally {
        $process.Dispose()
    }
}

function Test-RunnerConfigurationLauncher {
    $launcherTest = Join-Path $PSScriptRoot 'Test-RunnerConfigurationLauncher.ps1'
    try {
        & $launcherTest -LauncherPath $configurationLauncher
    } catch {
        throw "Runner configuration launcher test failed: $($_.Exception.Message)"
    }
    if (-not $?) {
        throw 'Runner configuration launcher test failed.'
    }
}

function Set-AndAssert-RunnerServiceRecovery {
    param([Parameter(Mandatory = $true)][string]$ServiceName)

    & $serviceRecoveryScript -ServiceName $ServiceName -AssertScript $serviceRecoveryTest
    if (-not $?) {
        throw 'Runner service failure recovery configuration failed.'
    }
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
    $runnerSettingsFile = Join-Path $runnerDirectory '.runner'
    if (Test-Path -LiteralPath $runnerSettingsFile) {
        $runnerSettings = Get-Content -LiteralPath $runnerSettingsFile -Raw | ConvertFrom-Json
        if ($runnerSettings.disableUpdate -ne $true) {
            throw 'The configured runner does not have auto-update disabled.'
        }
        Assert-RunnerAclPolicy
    }
    Invoke-AdmissionTests
    Test-RunnerConfigurationLauncher
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

    Invoke-AdmissionTests
    if ($existingService.State -eq 'Running') {
        Stop-Service -Name $existingServiceName -Force
    }
    New-Item -ItemType Directory -Path $runnerRoot -Force | Out-Null
    Set-RunnerRootPermissions
    Ensure-RunnerFiles
    Set-RunnerWritablePermissions
    Set-RunnerAutoUpdateDisabled
    Assert-RunnerAclPolicy
    Set-AndAssert-RunnerServiceRecovery -ServiceName $existingServiceName
    Set-ServiceProcessEnvironment -ServiceName $existingServiceName
    Set-Service -Name $existingServiceName -StartupType Automatic
    Start-Service -Name $existingServiceName
    $restartedService = Get-CimInstance Win32_Service -Filter "Name='$existingServiceName'"
    if ($restartedService.State -ne 'Running' -or $restartedService.StartMode -ne 'Auto' -or $restartedService.StartName -notmatch '(?i)LOCAL SERVICE') {
        throw 'The reused runner service did not remain running as auto-start LocalService.'
    }
    Write-Output "PASS: $runnerName is running as NT AUTHORITY\LOCAL SERVICE with automatic startup."
    exit 0
}

$gh = Get-Command gh.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
& $gh.Source auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI must be authenticated as a repository administrator before installing the runner.'
}

Invoke-AdmissionTests
New-Item -ItemType Directory -Path $runnerRoot -Force | Out-Null
Set-RunnerRootPermissions
Ensure-RunnerFiles
Set-RunnerWritablePermissions

$registrationToken = & $gh.Source api --method POST "repos/$owner/$repository/actions/runners/registration-token" --jq '.token'
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($registrationToken)) {
    $registrationToken = $null
    throw 'GitHub did not return a runner registration token.'
}
$registrationToken = $registrationToken.Trim()

try {
    Invoke-RunnerRegistrationWithSecret -RegistrationToken $registrationToken
} finally {
    $registrationToken = $null
    [GC]::Collect()
}

$serviceFile = Join-Path $runnerDirectory '.service'
if (-not (Test-Path -LiteralPath $serviceFile)) {
    throw 'Runner configuration completed but did not create the expected Windows service metadata.'
}
$serviceName = (Get-Content -LiteralPath $serviceFile -Raw).Trim()
$configuredService = Get-Service -Name $serviceName
if ($configuredService.Status -eq 'Running') {
    Stop-Service -Name $serviceName -Force
}
Set-RunnerRootPermissions
Ensure-RunnerFiles
Set-RunnerWritablePermissions
Set-RunnerAutoUpdateDisabled
Assert-RunnerAclPolicy
Set-AndAssert-RunnerServiceRecovery -ServiceName $serviceName
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
