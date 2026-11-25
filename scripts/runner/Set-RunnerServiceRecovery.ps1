[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServiceName,
    [Parameter(Mandatory = $true)]
    [string]$AssertScript
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sc = Join-Path $env:SystemRoot 'System32\sc.exe'
& $sc failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Could not set failure recovery for service: $ServiceName"
}
& $AssertScript -ServiceName $ServiceName
if (-not $?) {
    throw 'Runner service failure recovery verification failed.'
}
