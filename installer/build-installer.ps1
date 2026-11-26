# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [string]$OutputDir = "",
    [switch]$SkipInstall,
    [switch]$SkipCompile
)

$ErrorActionPreference = "Stop"
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if (-not $OutputDir) { $OutputDir = Join-Path $PSScriptRoot "build" }
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "build"))
if (-not ($OutputDir.Equals($allowedRoot, [StringComparison]::OrdinalIgnoreCase) -or $OutputDir.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase))) {
    throw "빌드 출력 경로는 installer\build 아래여야 합니다: $OutputDir"
}

function Write-Step {
    param([string]$Message)
    Write-Host "[build-installer] $Message"
}

function Copy-DirectoryContents {
    param([string]$Source, [string]$Destination)
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
}

$nodeCommand = Get-Command "node.exe" -ErrorAction SilentlyContinue
$npmCommand = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if (-not $nodeCommand -or -not $npmCommand) {
    throw "Node.js 24 이상과 npm이 필요합니다."
}
$nodeVersion = (& $nodeCommand.Source --version).Trim()
$nodeMajor = [int](($nodeVersion.TrimStart("v") -split "\.")[0])
if ($nodeMajor -lt 24) { throw "Node.js 24 이상이 필요합니다. 현재 버전: $nodeVersion" }

if (-not $SkipInstall) {
    Write-Step "npm ci"
    Push-Location $repoRoot
    try { & $npmCommand.Source ci } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "npm ci 실패" }
}

Write-Step "TypeScript 빌드"
Push-Location $repoRoot
try { & $npmCommand.Source run build } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "npm run build 실패" }

if (Test-Path -LiteralPath $OutputDir) {
    Remove-Item -LiteralPath $OutputDir -Recurse -Force
}
$payloadApp = Join-Path $OutputDir "payload\app"
New-Item -ItemType Directory -Path $payloadApp -Force | Out-Null
foreach ($directory in @("dist", "public", "poc\packages\engine", "seed")) {
    Copy-DirectoryContents -Source (Join-Path $repoRoot $directory) -Destination (Join-Path $payloadApp $directory)
}
foreach ($file in @("package.json", "package-lock.json", "LICENSE", "NOTICE")) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination (Join-Path $payloadApp $file) -Force
}
$payloadLegal = Join-Path $payloadApp "docs\legal"
New-Item -ItemType Directory -Path $payloadLegal -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "docs\legal\dependency-licenses.md") -Destination $payloadLegal -Force

Write-Step "프로덕션 의존성 설치"
Push-Location $payloadApp
try { & $npmCommand.Source ci --omit=dev --ignore-scripts } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "프로덕션 의존성 설치 실패" }

$portableRoot = Join-Path $OutputDir "portable\GugakSignage"
Copy-DirectoryContents -Source $payloadApp -Destination (Join-Path $portableRoot "app")
$portableInstaller = Join-Path $portableRoot "installer"
New-Item -ItemType Directory -Path $portableInstaller -Force | Out-Null
foreach ($file in @("install.ps1", "uninstall.ps1", "set-autostart.ps1", "GugakSignage.iss")) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $portableInstaller -Force
}
Copy-DirectoryContents -Source (Join-Path $PSScriptRoot "ops") -Destination (Join-Path $portableInstaller "ops")
$portableDocs = Join-Path $portableRoot "docs"
New-Item -ItemType Directory -Path $portableDocs -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "docs\install\README.md") -Destination $portableDocs -Force

$zipPath = Join-Path $OutputDir "GugakSignage-Portable-0.1.0.zip"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Write-Step "이식용 ZIP 생성"
Compress-Archive -Path (Join-Path $portableRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($zipPath + ".sha256") -Value "$hash  $(Split-Path -Leaf $zipPath)" -Encoding ascii

$isccPath = $null
if (-not $SkipCompile) {
    $iscc = Get-Command "iscc.exe" -ErrorAction SilentlyContinue
    if ($iscc) {
        $isccPath = $iscc.Source
    } else {
        $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
        $candidates = @(
            (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
            (Join-Path $programFilesX86 "Inno Setup 6\ISCC.exe"),
            (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
        )
        foreach ($candidate in $candidates) {
            if ($candidate -and (Test-Path -LiteralPath $candidate)) {
                $isccPath = $candidate
                break
            }
        }
    }
    if ($isccPath) {
        Write-Step "Inno Setup 컴파일"
        & $isccPath (Join-Path $PSScriptRoot "GugakSignage.iss")
        if ($LASTEXITCODE -ne 0) { throw "Inno Setup 컴파일 실패" }
    } else {
        Write-Warning "Inno Setup 6 ISCC.exe가 없어 .iss를 컴파일하지 않았습니다. PowerShell 설치 ZIP은 생성되었습니다."
    }
}

Write-Step "완료"
Write-Step "PowerShell 설치 ZIP: $zipPath"
Write-Step "SHA-256: $hash"
if ($isccPath) { Write-Step "Inno Setup: $(Join-Path $OutputDir 'inno')" }
