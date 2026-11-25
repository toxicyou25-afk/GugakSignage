[CmdletBinding()]
param(
    [string]$RunnerRoot = 'C:\actions-runners\GugakSignage'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$writeMask = [Security.AccessControl.FileSystemRights]'WriteData, AppendData, WriteExtendedAttributes, WriteAttributes, Delete, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership'
$modifyMask = [Security.AccessControl.FileSystemRights]'Modify'
$localServiceSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::LocalServiceSid, $null)
$authenticatedUsersSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::AuthenticatedUserSid, $null)
$builtinUsersSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::BuiltinUsersSid, $null)
$everyoneSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::WorldSid, $null)

$readOnlyPaths = @(
    $RunnerRoot,
    (Join-Path $RunnerRoot 'admission'),
    (Join-Path $RunnerRoot 'admission\Assert-TrustedJob.ps1'),
    (Join-Path $RunnerRoot 'runner'),
    (Join-Path $RunnerRoot 'runner\config.cmd'),
    (Join-Path $RunnerRoot 'runner\.service'),
    (Join-Path $RunnerRoot 'runner\.runner'),
    (Join-Path $RunnerRoot 'runner\.credentials'),
    (Join-Path $RunnerRoot 'runner\.credentials_rsaparams')
)

$writablePaths = @(
    (Join-Path $RunnerRoot '_work'),
    (Join-Path $RunnerRoot '_temp'),
    (Join-Path $RunnerRoot '_toolcache'),
    (Join-Path $RunnerRoot '_cache'),
    (Join-Path $RunnerRoot '_logs'),
    (Join-Path $RunnerRoot 'home'),
    (Join-Path $RunnerRoot 'runner\_work'),
    (Join-Path $RunnerRoot 'runner\_diag')
)

function Get-LocalServiceRules {
    param([Parameter(Mandatory = $true)][string]$Path)
    return @((Get-Acl -LiteralPath $Path).Access | Where-Object {
        $identity = if ($_.IdentityReference -is [Security.Principal.SecurityIdentifier]) {
            $_.IdentityReference
        } else {
            $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier])
        }
        $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        ($identity -eq $localServiceSid -or $_.IdentityReference.Value -like '*GITHUB_ActionsRunner_*')
    })
}

function Get-AceIdentitySid {
    param([Parameter(Mandatory = $true)]$Rule)
    if ($Rule.IdentityReference -is [Security.Principal.SecurityIdentifier]) {
        return $Rule.IdentityReference
    }
    return $Rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier])
}

foreach ($path in $readOnlyPaths) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required runner path is missing: $path"
    }
    foreach ($rule in Get-LocalServiceRules -Path $path) {
        if (($rule.FileSystemRights -band $writeMask) -ne 0) {
            throw "LocalService has write access to a runner-sensitive path: $path"
        }
    }
}

foreach ($path in $writablePaths) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required runner write path is missing: $path"
    }
    $rules = Get-LocalServiceRules -Path $path
    if (-not ($rules | Where-Object { ($_.FileSystemRights -band $modifyMask) -eq $modifyMask })) {
        throw "LocalService lacks the required Modify access on runner runtime path: $path"
    }
    foreach ($rule in (Get-Acl -LiteralPath $path).Access) {
        $sid = Get-AceIdentitySid -Rule $rule
        if (($sid -eq $authenticatedUsersSid -or $sid -eq $builtinUsersSid -or $sid -eq $everyoneSid) -and
            (($rule.FileSystemRights -band $writeMask) -ne 0)) {
            throw "Broad identity has write access to a runner runtime path: $path"
        }
    }
}

Write-Output 'PASS: LocalService has read-only access to runner controls and credentials, with Modify access only to runtime data paths and no broad write ACLs.'
