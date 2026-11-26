# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') {
    @{ supported = $false; monitors = @() } | ConvertTo-Json -Compress
    exit 0
}

Add-Type -AssemblyName System.Windows.Forms
if (-not ('GugakSignage.DisplayDevices' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace GugakSignage {
  public static class DisplayDevices {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct Device { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string DeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceString; public int StateFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceID; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceKey; }
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool EnumDisplayDevices(string device, uint index, ref Device output, uint flags);
  }
}
'@
}

$results = @()
foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
    $friendly = $screen.DeviceName
    $stableId = $screen.DeviceName
    $bindingId = $null
    for ($i = 0; $i -lt 32; $i++) {
        $candidate = New-Object GugakSignage.DisplayDevices+Device
        $candidate.cb = [Runtime.InteropServices.Marshal]::SizeOf($candidate)
        if (-not [GugakSignage.DisplayDevices]::EnumDisplayDevices($screen.DeviceName, [uint32]$i, [ref]$candidate, 0)) { break }
        if ($candidate.StateFlags -band 1) {
            if ($candidate.DeviceString) { $friendly = $candidate.DeviceString }
            if ($candidate.DeviceID -match '^MONITOR\\') {
                $stableId = $candidate.DeviceID
                $bindingId = [string]$candidate.DeviceID
            }
            break
        }
    }
    $bounds = $screen.Bounds
    $width = [int]$bounds.Width
    $height = [int]$bounds.Height
    $results += [pscustomobject]@{
        stableId = [string]$stableId; bindingId = $bindingId; deviceName = [string]$screen.DeviceName; friendlyName = [string]$friendly
        x = [int]$bounds.X; y = [int]$bounds.Y; width = $width; height = $height
        orientation = $(if ($height -gt $width) { 'portrait' } else { 'landscape' })
        primary = [bool]$screen.Primary; attached = $true
    }
}
@{ supported = $true; monitors = @($results) } | ConvertTo-Json -Depth 4 -Compress
