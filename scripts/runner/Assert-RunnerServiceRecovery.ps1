[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServiceName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sc = Join-Path $env:SystemRoot 'System32\sc.exe'
$output = & $sc qfailure $ServiceName 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Could not query failure recovery for service: $ServiceName"
}
$text = $output -join "`n"
if ($text -notmatch 'RESET_PERIOD\s*\(in seconds\)\s*:\s*86400') {
    throw 'Runner service failure count reset period is not 86400 seconds.'
}
$restartCount = [regex]::Matches($text, 'RESTART\s*--\s*Delay\s*=\s*60000\s*milliseconds').Count
if ($restartCount -ne 3) {
    throw "Runner service must define three 60-second restart actions; found $restartCount."
}

Write-Output 'PASS: runner service recovery restarts up to three times after 60 seconds and resets the failure count after 86400 seconds.'
