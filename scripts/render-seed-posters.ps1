# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$seedDir = Join-Path $repoRoot 'seed'
$edgeCandidates = @(
    (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Microsoft\Edge\Application\msedge.exe')
)
$edgeCommand = Get-Command 'msedge.exe' -ErrorAction SilentlyContinue
$edgePath = if ($edgeCommand) { $edgeCommand.Source } else { $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 }
if (-not $edgePath) { throw 'Microsoft Edge is required to render the seed poster SVGs.' }

$items = @(
    @{ Name = 'poster-autumn'; Width = 1920; Height = 1080 },
    @{ Name = 'poster-class'; Width = 1920; Height = 1080 },
    @{ Name = 'poster-welcome'; Width = 1080; Height = 1920 }
)
$profileRoot = Join-Path ([IO.Path]::GetTempPath()) ('gugak-seed-render-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null

try {
    foreach ($item in $items) {
        $sourcePath = [IO.Path]::GetFullPath((Join-Path (Join-Path $seedDir 'source') ($item.Name + '.svg')))
        $outputPath = Join-Path $seedDir ($item.Name + '.png')
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Missing SVG source: $sourcePath" }
        $profilePath = Join-Path $profileRoot $item.Name
        $sourceUri = ([uri]$sourcePath).AbsoluteUri
        $arguments = @(
            '--headless=new',
            '--no-sandbox',
            '--disable-gpu',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--disable-features=Vulkan',
            '--disable-background-networking',
            '--disable-component-update',
            '--no-first-run',
            '--disable-sync',
            '--force-device-scale-factor=1',
            "--window-size=$($item.Width),$($item.Height)",
            "--user-data-dir=`"$profilePath`"",
            "--screenshot=`"$outputPath`"",
            "`"$sourceUri`""
        )
        $process = Start-Process -FilePath $edgePath -ArgumentList $arguments -Wait -PassThru -NoNewWindow
        if ($process.ExitCode -ne 0) { throw "Edge failed to render $($item.Name): exit $($process.ExitCode)" }
        if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) { throw "Edge did not create $outputPath" }

        $bytes = [IO.File]::ReadAllBytes($outputPath)
        if ($bytes.Length -lt 24 -or $bytes[0] -ne 137 -or $bytes[1] -ne 80 -or $bytes[2] -ne 78 -or $bytes[3] -ne 71) {
            throw "Output is not a PNG: $outputPath"
        }
        $width = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($bytes, 16))
        $height = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($bytes, 20))
        if ($width -ne $item.Width -or $height -ne $item.Height) {
            throw "Unexpected dimensions for $outputPath`: ${width}x${height}"
        }
        $hash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
        Write-Output "$($item.Name): ${width}x${height}, $($bytes.Length) bytes, SHA-256 $hash"
    }
    Write-Output "Rendered with Microsoft Edge $((Get-Item -LiteralPath $edgePath).VersionInfo.ProductVersion) using SwiftShader."
} finally {
    Remove-Item -LiteralPath $profileRoot -Recurse -Force -ErrorAction SilentlyContinue
}
