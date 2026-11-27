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

function Resolve-AdminUrl {
    param([string]$ConfigPath, [int]$RequestedPort)
    if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
        try {
            $config = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($ConfigPath, [Text.UTF8Encoding]::new($false, $true)))
            if ($config.role -eq "player-host" -or $config.setupRole -eq "player") {
                throw "Player-only install has no local Manager admin page."
            }
            if ($config.adminUrl) {
                $uri = $null
                $validUri = [Uri]::TryCreate([string]$config.adminUrl, [UriKind]::Absolute, [ref]$uri)
                $validIntegratedHttp = $validUri -and $config.role -eq "integrated" -and $uri.Scheme -eq "http" -and
                    ($uri.Host -eq "127.0.0.1" -or $uri.Host -eq "localhost" -or $uri.Host -eq "::1")
                $validManagerHttps = $validUri -and $config.role -eq "manager" -and $uri.Scheme -eq "https"
                if (-not ($validIntegratedHttp -or $validManagerHttps) -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
                    ($uri.AbsolutePath -ne "/admin/" -and $uri.AbsolutePath -ne "/admin")) {
                    throw "install.json contains an invalid adminUrl for its install role. Refusing to open a fallback URL."
                }
                $manifestPort = 0
                if ($config.port -and [int]::TryParse([string]$config.port, [ref]$manifestPort) -and
                    $manifestPort -ge 1 -and $manifestPort -le 65535 -and $uri.Port -ne $manifestPort) {
                    throw "install.json adminUrl port does not match the Manager listener port."
                }
                if ($RequestedPort -ge 1 -and $RequestedPort -le 65535 -and $uri.Port -ne $RequestedPort) {
                    throw "Requested admin port does not match the configured HTTPS Manager URL."
                }
                return $uri.AbsoluteUri
            }
            if ($config.role -eq "manager" -and $config.mode -eq "lan") {
                throw "LAN Manager install.json has no adminUrl. Refusing to open a fallback URL."
            }
        } catch {
            if ($_.Exception.Message -match "invalid adminUrl|does not match|has no adminUrl|Player-only install") { throw }
            # Older/corrupt manifests without an adminUrl retain the legacy localhost default.
        }
    }
    $port = Resolve-AdminPort -ConfigPath $ConfigPath -RequestedPort $RequestedPort
    return "http://127.0.0.1:$port/admin/"
}

if (-not $InstallDir) {
    $InstallDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
$configPath = Join-Path $InstallDir "install.json"
$adminUrl = Resolve-AdminUrl -ConfigPath $configPath -RequestedPort $Port

if ($PrintOnly) {
    Write-Output $adminUrl
    return
}

# Start-Process with a URL hands the address to the current user's default browser.
# This script intentionally never requests elevation.
Start-Process -FilePath $adminUrl | Out-Null
