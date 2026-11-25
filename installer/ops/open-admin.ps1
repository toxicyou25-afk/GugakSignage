# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [ValidateRange(0, 65535)][int]$Port = 0,
    [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

function Resolve-AdminPort {
    param([string]$ConfigPath, [int]$RequestedPort)
    if ($RequestedPort -ge 1 -and $RequestedPort -le 65535) { return $RequestedPort }
    if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
        try {
            $config = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($ConfigPath, [Text.UTF8Encoding]::new($false, $true)))
            $configuredPort = 0
            if ($config.port -and [int]::TryParse([string]$config.port, [ref]$configuredPort) -and
                $configuredPort -ge 1 -and $configuredPort -le 65535) {
                return $configuredPort
            }
        } catch {
            # A damaged manifest must not stop the operator from opening the default admin URL.
        }
    }
    return 3000
}

if (-not $InstallDir) {
    $InstallDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
$configPath = Join-Path $InstallDir "install.json"
$adminPort = Resolve-AdminPort -ConfigPath $configPath -RequestedPort $Port
$adminUrl = "http://127.0.0.1:$adminPort/admin/"

if ($PrintOnly) {
    Write-Output $adminUrl
    return
}

# Start-Process with a URL hands the address to the current user's default browser.
# This script intentionally never requests elevation.
Start-Process -FilePath $adminUrl | Out-Null
