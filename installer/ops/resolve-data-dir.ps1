# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$DefaultDataDir,
    [Parameter(Mandatory = $true)][string]$OutputFile
)

$ErrorActionPreference = "Stop"
$commonCandidates = @(
    (Join-Path $PSScriptRoot "resolver-common.ps1"),
    (Join-Path $PSScriptRoot "install-common.ps1")
)
$commonPath = $commonCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $commonPath) { throw "install-common.ps1을 찾지 못했습니다." }
. $commonPath

function ConvertTo-TransportHex {
    param([AllowEmptyString()][string]$Value)
    return [BitConverter]::ToString([Text.Encoding]::Unicode.GetBytes($Value)).Replace("-", "")
}

try {
    $resolved = Resolve-InstallerDataDir -InstallDir $InstallDir -DefaultDataDir $DefaultDataDir
    # Only an install manifest or legacy InstallDir\.env proves a previous
    # installation. A plain default data folder alone must not block a fresh
    # install with an explicit DATADIR.
    $isExisting = [int]$resolved.HasPreviousEvidence
    $payload = "OK|$(ConvertTo-TransportHex -Value ([string]$resolved.DataDir))|$isExisting"
    [IO.File]::WriteAllText($OutputFile, $payload, [Text.Encoding]::ASCII)
    exit 0
} catch {
    $payload = "ERR|$(ConvertTo-TransportHex -Value $_.Exception.Message)"
    [IO.File]::WriteAllText($OutputFile, $payload, [Text.Encoding]::ASCII)
    exit 1
}

