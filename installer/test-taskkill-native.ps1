# SPDX-License-Identifier: Apache-2.0
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "ops\install-common.ps1")

$result = Invoke-TaskkillProcessTree -ProcessId 0
if ($result.ExitCode -eq 0) {
    throw "taskkill unexpectedly reported success for protected PID 0."
}
if ([string]::IsNullOrWhiteSpace([string]$result.Output)) {
    throw "taskkill failure output was not captured."
}

$script:mockProcessAlive = $true
$script:mockVerifyCount = 0
$script:mockVerifiedResults = @($true, $true)
$script:mockTaskkillCalls = @()
function Get-CimInstance {
    [CmdletBinding()]
    param([string]$ClassName, [string]$Filter)
    [pscustomobject]@{
        ProcessId = 424242
        ExecutablePath = "C:\Program Files\Node\node.exe"
        CreationDate = [DateTime]::UtcNow
        CommandLine = '"C:\Program Files\Node\node.exe" "C:\GugakSignage\dist\server.js"'
    }
}
function Get-VerifiedOwnedProcess {
    [CmdletBinding()]
    param(
        [int]$ProcessId,
        [string]$ExpectedExecutable,
        [string]$ExpectedStartTime,
        [string[]]$CommandLineContains = @(),
        [string]$InstallDir = ""
    )
    $index = $script:mockVerifyCount
    $script:mockVerifyCount++
    if ($index -lt $script:mockVerifiedResults.Count -and $script:mockVerifiedResults[$index]) {
        return [pscustomobject]@{ ProcessId = $ProcessId }
    }
    return $null
}
function Get-Process {
    [CmdletBinding()]
    param([int]$Id)
    if ($script:mockProcessAlive) { return [pscustomobject]@{ Id = $Id } }
    return $null
}
function Invoke-TaskkillProcessTree {
    [CmdletBinding()]
    param([int]$ProcessId, [switch]$RootOnly)
    $script:mockTaskkillCalls += [pscustomobject]@{ ProcessId = $ProcessId; RootOnly = [bool]$RootOnly }
    if (-not $RootOnly) { return [pscustomobject]@{ ExitCode = 128; Output = "access denied for child process" } }
    $script:mockProcessAlive = $false
    return [pscustomobject]@{ ExitCode = 0; Output = "" }
}

$stopped = Stop-VerifiedOwnedProcess -ProcessId 424242 -ExpectedExecutable "C:\Program Files\Node\node.exe" -ExpectedStartTime ([DateTime]::UtcNow.ToString("o")) -CommandLineContains @("C:\GugakSignage", "dist\server.js")
if (-not $stopped -or $script:mockTaskkillCalls.Count -ne 2 -or $script:mockTaskkillCalls[0].RootOnly -or -not $script:mockTaskkillCalls[1].RootOnly) {
    throw "Tree termination failure must retry only the freshly verified root process."
}

$script:mockProcessAlive = $true
$script:mockVerifyCount = 0
$script:mockVerifiedResults = @($true, $false)
$script:mockTaskkillCalls = @()
$identityChangedError = ""
try {
    Stop-VerifiedOwnedProcess -ProcessId 424242 -ExpectedExecutable "C:\Program Files\Node\node.exe" -ExpectedStartTime ([DateTime]::UtcNow.ToString("o")) -CommandLineContains @("C:\GugakSignage", "dist\server.js") | Out-Null
} catch {
    $identityChangedError = $_.Exception.Message
}
if ($identityChangedError -notmatch "IDENTITY_CHANGED" -or $script:mockTaskkillCalls.Count -ne 1 -or $script:mockTaskkillCalls[0].RootOnly) {
    throw "Root-only retry must fail closed when the PID no longer matches the installed process."
}

[pscustomobject]@{
    result = "passed"
    nonZeroExitPreserved = $true
    diagnosticCaptured = $true
    verifiedRootRetry = $true
    pidReuseBlockedAfterTreeFailure = $true
} | ConvertTo-Json -Compress

