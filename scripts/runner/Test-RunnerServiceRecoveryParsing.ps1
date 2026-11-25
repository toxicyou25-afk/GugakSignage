[CmdletBinding()]
param(
    [string]$AssertScript
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($AssertScript)) {
    $AssertScript = Join-Path $scriptRoot 'Assert-RunnerServiceRecovery.ps1'
}
if (-not (Test-Path -LiteralPath $AssertScript -PathType Leaf)) {
    throw "Assertion script not found: $AssertScript"
}

function New-FailureOutput {
    param(
        [Parameter(Mandatory = $true)][string]$ActionLine,
        [int]$ActionCount = 3,
        [int]$ResetPeriod = 86400
    )

    $lines = @(
        '[SC] QueryServiceConfig2 SUCCESS',
        '',
        'SERVICE_NAME: fixture',
        ('        RESET_PERIOD (in seconds)    : {0}' -f $ResetPeriod),
        '        REBOOT_MESSAGE               : ',
        '        COMMAND_LINE                 : ',
        ('        FAILURE_ACTIONS              : {0}' -f $ActionLine)
    )
    for ($index = 1; $index -lt $ActionCount; $index++) {
        $lines += ('                                       {0}' -f $ActionLine)
    }
    return ($lines -join [Environment]::NewLine)
}

function Invoke-ExpectPass {
    param([string]$Name, [string]$Output)

    try {
        & $AssertScript -ServiceName 'fixture' -FailureOutput $Output | Out-Null
    } catch {
        throw "Expected PASS for $Name but got: $($_.Exception.Message)"
    }
    Write-Output "PASS: $Name"
}

function Invoke-ExpectFail {
    param([string]$Name, [string]$Output)

    $failed = $false
    try {
        & $AssertScript -ServiceName 'fixture' -FailureOutput $Output | Out-Null
    } catch {
        $failed = $true
    }
    if (-not $failed) {
        throw "Expected FAIL for $Name but the assertion passed."
    }
    Write-Output "PASS: $Name rejected"
}

$englishAction = 'RESTART -- Delay = 60000 milliseconds.'
$koreanAction = -join @(
    [char]0xB2E4, [char]0xC2DC, ' ', [char]0xC2DC, [char]0xC791, ' -- ',
    [char]0xC9C0, [char]0xC5F0, ' = 60000', [char]0xBC00, [char]0xB9AC, [char]0xCD08, '.'
)

Invoke-ExpectPass -Name 'en-US refresh actions' -Output (New-FailureOutput -ActionLine $englishAction)
Invoke-ExpectPass -Name 'ko-KR refresh actions' -Output (New-FailureOutput -ActionLine $koreanAction)
Invoke-ExpectFail -Name 'two refresh actions' -Output (New-FailureOutput -ActionLine $englishAction -ActionCount 2)
Invoke-ExpectFail -Name 'wrong reset period' -Output (New-FailureOutput -ActionLine $englishAction -ResetPeriod 43200)

Write-Output 'PASS: service recovery assertion accepts en-US and ko-KR sc.exe output.'
