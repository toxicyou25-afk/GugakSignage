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

[pscustomobject]@{
    result = "passed"
    nonZeroExitPreserved = $true
    diagnosticCaptured = $true
} | ConvertTo-Json -Compress
