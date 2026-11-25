[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServiceName,
    [string]$FailureOutput
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($FailureOutput)) {
    $sc = Join-Path $env:SystemRoot 'System32\sc.exe'
    $output = & $sc qfailure $ServiceName 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Could not query failure recovery for service: $ServiceName"
    }
    $text = $output -join [Environment]::NewLine
} else {
    $text = $FailureOutput
}

# Only the reset-period field contains 86400 in sc.exe qfailure output. Match the
# numeric value instead of the localized field label.
if ($text -notmatch '(?m)^[^\r\n:]+:\s*86400\s*$') {
    throw 'Runner service failure count reset period is not 86400 seconds.'
}

# sc.exe localizes the restart action lines. Accept en-US and ko-KR forms:
#   RESTART -- Delay = 60000 milliseconds.
#   The same action line with localized Korean words.
# The Korean words are Unicode escapes so the file stays encoding-neutral.
$restartPattern = '(?m)(?:RESTART|\uB2E4\uC2DC\s*\uC2DC\uC791)\s*--\s*(?:Delay|\uC9C0\uC5F0)\s*=\s*60000\s*(?:milliseconds|\uBC00\uB9AC\uCD08)'
$restartCount = [regex]::Matches($text, $restartPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase).Count
if ($restartCount -ne 3) {
    throw "Runner service must define three 60-second restart actions; found $restartCount."
}

Write-Output 'PASS: runner service recovery restarts up to three times after 60 seconds and resets the failure count after 86400 seconds.'
