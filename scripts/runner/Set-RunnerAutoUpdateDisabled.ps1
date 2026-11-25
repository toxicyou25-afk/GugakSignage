[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SettingsFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SettingsFile -PathType Leaf)) {
    throw 'Runner settings are missing while attempting to disable auto-update.'
}

$settings = Get-Content -LiteralPath $SettingsFile -Raw | ConvertFrom-Json
$disableUpdateProperty = $settings.PSObject.Properties['disableUpdate']
if ($null -eq $disableUpdateProperty -or $disableUpdateProperty.Value -ne $true) {
    if ($null -eq $disableUpdateProperty) {
        $settings | Add-Member -NotePropertyName disableUpdate -NotePropertyValue $true
    } else {
        $disableUpdateProperty.Value = $true
    }

    $settingsJson = $settings | ConvertTo-Json -Depth 20
    $settingsDirectory = Split-Path -Parent $SettingsFile
    $temporarySettings = Join-Path $settingsDirectory ".runner.disable-update.$PID.tmp"
    try {
        [IO.File]::WriteAllText($temporarySettings, $settingsJson, [Text.UTF8Encoding]::new($false))
        $settingsItem = Get-Item -LiteralPath $SettingsFile -Force
        $settingsItem.Attributes = $settingsItem.Attributes -band (-bnot [IO.FileAttributes]::Hidden)
        Move-Item -LiteralPath $temporarySettings -Destination $SettingsFile -Force
    } finally {
        if (Test-Path -LiteralPath $temporarySettings) {
            Remove-Item -LiteralPath $temporarySettings -Force
        }
    }
}

$updatedSettings = Get-Content -LiteralPath $SettingsFile -Raw | ConvertFrom-Json
if ($updatedSettings.disableUpdate -ne $true) {
    throw 'Runner auto-update could not be disabled in the local runner settings.'
}
$settingsItem = Get-Item -LiteralPath $SettingsFile -Force
$settingsItem.Attributes = $settingsItem.Attributes -bor [IO.FileAttributes]::Hidden

Write-Output 'PASS: runner auto-update is disabled.'
