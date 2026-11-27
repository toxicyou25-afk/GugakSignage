# SPDX-License-Identifier: Apache-2.0

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    if ($full.Length -gt $root.Length) {
        return $full.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    }
    return $full
}

if (-not ([System.Management.Automation.PSTypeName]'GugakPathNative').Type) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class GugakPathNative
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern SafeFileHandle CreateFileW(
        string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes,
        uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetFinalPathNameByHandleW(
        SafeFileHandle fileHandle, StringBuilder filePath, uint filePathLength, uint flags);
}
"@
}

function Resolve-ExistingCanonicalPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $handle = [GugakPathNative]::CreateFileW($Path, 0, 7, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
    if (-not $handle -or $handle.IsInvalid) {
        if ($handle) { $handle.Dispose() }
        return ""
    }
    try {
        $builder = [Text.StringBuilder]::new(32768)
        $length = [GugakPathNative]::GetFinalPathNameByHandleW($handle, $builder, [uint32]$builder.Capacity, 0)
        if ($length -eq 0 -or $length -ge $builder.Capacity) { return "" }
        $resolved = $builder.ToString()
        if ($resolved.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) {
            return '\\' + $resolved.Substring(8)
        }
        if ($resolved.StartsWith('\\?\', [StringComparison]::Ordinal)) { return $resolved.Substring(4) }
        return $resolved
    } finally {
        $handle.Dispose()
    }
}

function Get-CanonicalPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $full = Get-NormalizedPath -Path $Path
    if (-not $full) { return "" }
    $remaining = [Collections.Generic.List[string]]::new()
    $current = $full
    while ($current) {
        $resolved = Resolve-ExistingCanonicalPath -Path $current
        if ($resolved) {
            $result = Get-NormalizedPath -Path $resolved
            for ($index = $remaining.Count - 1; $index -ge 0; $index--) {
                $result = Get-NormalizedPath -Path (Join-Path $result $remaining[$index])
            }
            return $result
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if (-not $parent -or $parent -eq $current) { return $full }
        $remaining.Add([IO.Path]::GetFileName($current))
        $current = $parent
    }
    return $full
}

function Test-PathEqual {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )
    $leftPath = Get-CanonicalPath -Path $Left
    $rightPath = Get-CanonicalPath -Path $Right
    return $leftPath.Equals($rightPath, [StringComparison]::OrdinalIgnoreCase)
}

function Test-PathWithin {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Parent
    )
    $childPath = Get-CanonicalPath -Path $Path
    $parentPath = Get-CanonicalPath -Path $Parent
    $parentPrefix = $parentPath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    return $childPath.StartsWith($parentPrefix, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-DataDirOutsideInstall {
    param(
        [Parameter(Mandatory = $true)][string]$InstallDir,
        [Parameter(Mandatory = $true)][string]$DataDir
    )
    $normalizedInstall = Get-NormalizedPath -Path $InstallDir
    $normalizedData = Get-NormalizedPath -Path $DataDir
    if ((Test-PathEqual -Left $normalizedInstall -Right $normalizedData) -or
        (Test-PathWithin -Path $normalizedData -Parent $normalizedInstall) -or
        (Test-PathWithin -Path $normalizedInstall -Parent $normalizedData)) {
        throw "데이터 폴더는 설치 폴더와 같거나 그 안에 있을 수 없습니다. 설치: $normalizedInstall, 데이터: $normalizedData"
    }
}

function Get-PathDepthBelowRoot {
    param([Parameter(Mandatory = $true)][string]$Path)
    $full = Get-NormalizedPath -Path $Path
    $root = [IO.Path]::GetPathRoot($full)
    if ($full.Equals($root, [StringComparison]::OrdinalIgnoreCase)) { return 0 }
    $relative = $full.Substring($root.Length).Trim([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    return @($relative -split "[\\/]" | Where-Object { $_ }).Count
}

function Get-UserDocumentsPath {
    param(
        [AllowEmptyString()][string]$KnownFolderPath,
        [AllowEmptyString()][string]$UserProfilePath
    )
    if (-not $PSBoundParameters.ContainsKey("KnownFolderPath")) {
        $KnownFolderPath = [Environment]::GetFolderPath("MyDocuments")
    }
    if (-not $PSBoundParameters.ContainsKey("UserProfilePath")) {
        $UserProfilePath = $env:USERPROFILE
    }
    if (-not [string]::IsNullOrWhiteSpace($KnownFolderPath)) {
        return Get-NormalizedPath -Path $KnownFolderPath
    }
    if ([string]::IsNullOrWhiteSpace($UserProfilePath)) { return "" }
    return Get-NormalizedPath -Path (Join-Path $UserProfilePath "Documents")
}

function Assert-SafeDataRemovalTarget {
    param(
        [Parameter(Mandatory = $true)][string]$DataDir,
        [string[]]$ProtectedPaths = @()
    )
    $target = Get-NormalizedPath -Path $DataDir
    $root = [IO.Path]::GetPathRoot($target)
    if ($target.Equals($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "드라이브 루트는 삭제할 수 없습니다: $target"
    }
    if ((Get-PathDepthBelowRoot -Path $target) -lt 2) {
        throw "너무 얕은 폴더는 -RemoveData로 삭제할 수 없습니다: $target"
    }

    $protectedTrees = @(
        (Join-Path $env:SystemRoot ""),
        (Join-Path $env:ProgramFiles ""),
        ([Environment]::GetEnvironmentVariable("ProgramFiles(x86)")),
        ([Environment]::GetFolderPath("Desktop")),
        (Get-UserDocumentsPath),
        ([Environment]::GetFolderPath("MyPictures")),
        ([Environment]::GetFolderPath("MyVideos")),
        $ProtectedPaths
    ) | Where-Object { $_ } | ForEach-Object { Get-NormalizedPath -Path $_ }

    foreach ($protectedRoot in $protectedTrees) {
        if ((Test-PathEqual -Left $target -Right $protectedRoot) -or
            (Test-PathWithin -Path $target -Parent $protectedRoot)) {
            throw "시스템 또는 사용자 문서 폴더는 -RemoveData로 삭제할 수 없습니다: $target"
        }
    }

    $exactProtected = @(
        $env:ProgramData,
        $env:LOCALAPPDATA,
        $env:APPDATA,
        $env:USERPROFILE
    ) | Where-Object { $_ } | ForEach-Object { Get-NormalizedPath -Path $_ }
    foreach ($protectedRoot in $exactProtected) {
        if (Test-PathEqual -Left $target -Right $protectedRoot) {
            throw "시스템·사용자 기준 폴더는 -RemoveData로 삭제할 수 없습니다: $target"
        }
    }

    $tempRoot = Get-NormalizedPath -Path ([IO.Path]::GetTempPath())
    if ((Test-PathEqual -Left $target -Right $tempRoot) -or (Test-PathWithin -Path $target -Parent $tempRoot)) {
        throw "임시 폴더는 -RemoveData로 삭제할 수 없습니다: $target"
    }

    foreach ($protectedPath in $ProtectedPaths) {
        if (-not $protectedPath) { continue }
        $normalizedProtected = Get-NormalizedPath -Path $protectedPath
        if ((Test-PathEqual -Left $target -Right $normalizedProtected) -or
            (Test-PathWithin -Path $normalizedProtected -Parent $target) -or
            (Test-PathWithin -Path $target -Parent $normalizedProtected)) {
            throw "데이터 폴더가 보호 대상과 겹칩니다. 데이터: $target, 보호 대상: $normalizedProtected"
        }
    }
}

function Get-ProcessExecutableFromCommandLine {
    param([string]$CommandLine)
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return "" }

    $value = $CommandLine.TrimStart()
    if ($value.StartsWith('"', [StringComparison]::Ordinal)) {
        $endQuote = $value.IndexOf('"', 1)
        if ($endQuote -le 1) { return "" }
        return $value.Substring(1, $endQuote - 1)
    }

    $match = [Regex]::Match($value, '^(?<executable>[^\s]+)(?:\s|$)')
    if (-not $match.Success) { return "" }
    return $match.Groups["executable"].Value
}

function Get-VerifiedOwnedProcess {
    param(
        [int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
        [string]$ExpectedStartTime = "",
        [string[]]$CommandLineContains = @()
    )
    if ($ProcessId -le 0) { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    $actualExecutable = [string]$process.ExecutablePath
    if (-not $actualExecutable) {
        $actualExecutable = Get-ProcessExecutableFromCommandLine -CommandLine ([string]$process.CommandLine)
    }
    if (-not $actualExecutable -or -not (Test-PathEqual -Left $actualExecutable -Right $ExpectedExecutable)) { return $null }
    if ($ExpectedStartTime) {
        $expected = [DateTimeOffset]::Parse($ExpectedStartTime).UtcDateTime
        $actual = ([DateTime]$process.CreationDate).ToUniversalTime()
        if ([Math]::Abs(($actual - $expected).TotalSeconds) -gt 20) { return $null }
    }
    $commandLine = [string]$process.CommandLine
    foreach ($marker in $CommandLineContains) {
        if ($marker -and $commandLine.IndexOf($marker, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            return $null
        }
    }
    return $process
}

function Stop-VerifiedOwnedProcess {
    param(
        [int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
        [string]$ExpectedStartTime = "",
        [string[]]$CommandLineContains = @()
    )
    if ($ProcessId -le 0) { return $false }
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    $process = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
        if (-not $process) { return $false }
        $verified = Get-VerifiedOwnedProcess -ProcessId $ProcessId -ExpectedExecutable $ExpectedExecutable -ExpectedStartTime $ExpectedStartTime -CommandLineContains $CommandLineContains
        if ($verified) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $verified) {
        $actualStart = if ($process.CreationDate) { ([DateTime]$process.CreationDate).ToUniversalTime().ToString("o") } else { "<unknown>" }
        $commandLine = [string]$process.CommandLine
        $commandLineExecutable = Get-ProcessExecutableFromCommandLine -CommandLine $commandLine
        $missingMarkers = @($CommandLineContains | Where-Object {
            $_ -and $commandLine.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -lt 0
        }) -join ","
        throw "프로세스 소유권을 확인하지 못해 종료하지 않았습니다. PID=$ProcessId, expected=$ExpectedExecutable @ $ExpectedStartTime, actual=$($process.ExecutablePath) @ $actualStart, commandLineExecutable=$commandLineExecutable, commandLineAvailable=$([bool]$commandLine), missingMarkers=$missingMarkers"
    }
    $result = & taskkill.exe /PID $ProcessId /T /F 2>&1
    $exitCode = $LASTEXITCODE
    $stillRunning = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($exitCode -ne 0 -and $stillRunning) {
        throw "프로세스 종료에 실패했습니다. PID=$ProcessId, exit=$exitCode, output=$($result -join ' ')"
    }
    return $true
}

function Test-ShortcutOwnedByInstall {
    param(
        [Parameter(Mandatory = $true)][string]$ShortcutPath,
        [Parameter(Mandatory = $true)][string]$InstallDir
    )
    if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) { return $true }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
    $launcher = Join-Path $InstallDir "ops\watchdog-launch.vbs"
    return ((Test-PathEqual -Left ([string]$shortcut.TargetPath) -Right $wscript) -and
        ([string]$shortcut.Arguments).IndexOf($launcher, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        (Test-PathEqual -Left ([string]$shortcut.WorkingDirectory) -Right $InstallDir))
}

function Test-AdminShortcutOwnedByInstall {
    param(
        [Parameter(Mandatory = $true)][string]$ShortcutPath,
        [Parameter(Mandatory = $true)][string]$InstallDir
    )
    if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) { return $true }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
    $launcher = Join-Path $InstallDir "ops\admin-launch.vbs"
    return ((Test-PathEqual -Left ([string]$shortcut.TargetPath) -Right $wscript) -and
        ([string]$shortcut.Arguments).IndexOf($launcher, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        (Test-PathEqual -Left ([string]$shortcut.WorkingDirectory) -Right $InstallDir))
}

function Test-ScheduledTaskOwnedByInstall {
    param(
        [Parameter(Mandatory = $true)]$Task,
        [Parameter(Mandatory = $true)][string]$InstallDir
    )
    if (-not $Task -or ([string]$Task.Description).IndexOf("GugakSignage", [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
    $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
    $launcher = Join-Path $InstallDir "ops\watchdog-launch.vbs"
    foreach ($action in @($Task.Actions)) {
        if ((Test-PathEqual -Left ([string]$action.Execute) -Right $wscript) -and
            ([string]$action.Arguments).IndexOf($launcher, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            (Test-PathEqual -Left ([string]$action.WorkingDirectory) -Right $InstallDir)) {
            return $true
        }
    }
    return $false
}

function Read-EnvFileLines {
    param([Parameter(Mandatory = $true)][string]$EnvFile)
    $utf8 = [Text.UTF8Encoding]::new($false, $true)
    try {
        $text = $utf8.GetString([IO.File]::ReadAllBytes($EnvFile))
    } catch {
        $text = [IO.File]::ReadAllText($EnvFile, [Text.Encoding]::Default)
    }
    $text = $text.TrimStart([char[]]@([char]0xFEFF))
    return [regex]::Split($text, "\r?\n")
}

function Get-EnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$EnvFile,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if (-not (Test-Path -LiteralPath $EnvFile)) { return "" }
    $pattern = "^\s*(?:export\s+)?" + [regex]::Escape($Name) + "\s*=\s*(.*)$"
    $values = @()
    foreach ($line in @(Read-EnvFileLines -EnvFile $EnvFile)) {
        $match = [regex]::Match($line, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($match.Success) {
            $values += ConvertFrom-EnvScalarValue -Value $match.Groups[1].Value
        }
    }
    if ($values.Count -eq 0) { return "" }
    $distinctValues = @($values | Select-Object -Unique)
    if ($distinctValues.Count -gt 1) {
        throw "환경 설정 파일에 서로 다른 $Name 값이 여러 개 있습니다: $EnvFile"
    }
    return [string]$distinctValues[0]
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    $encoding = [Text.UTF8Encoding]::new($false, $true)
    $json = [IO.File]::ReadAllText($Path, $encoding)
    return ConvertFrom-Json -InputObject $json -ErrorAction Stop
}

function ConvertFrom-EnvScalarValue {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)
    $raw = $Value.Trim()
    if (-not $raw) { return "" }
    $quote = [char]0
    if ($raw[0] -eq [char]34 -or $raw[0] -eq [char]39) { $quote = $raw[0] }
    if ($quote -ne [char]0) {
        $builder = [Text.StringBuilder]::new()
        $closed = $false
        for ($index = 1; $index -lt $raw.Length; $index++) {
            $character = $raw[$index]
            if ($character -eq [char]92 -and ($index + 1) -lt $raw.Length) {
                $next = $raw[$index + 1]
                if (($quote -eq [char]34 -and ($next -eq [char]34 -or $next -eq [char]92)) -or
                    ($quote -eq [char]39 -and $next -eq [char]39)) {
                    [void]$builder.Append($next)
                    $index++
                    continue
                }
                [void]$builder.Append($character)
                continue
            }
            if ($character -eq $quote) {
                $trailing = $raw.Substring($index + 1).Trim()
                if ($trailing -and -not $trailing.StartsWith("#")) {
                    throw "환경 설정 값의 따옴표 뒤에 예상하지 못한 문자가 있습니다."
                }
                $closed = $true
                break
            }
            [void]$builder.Append($character)
        }
        if (-not $closed) { throw "환경 설정 값의 따옴표가 닫히지 않았습니다." }
        return $builder.ToString()
    }
    $comment = [regex]::Match($raw, "\s+#")
    if ($comment.Success) { $raw = $raw.Substring(0, $comment.Index).TrimEnd() }
    return $raw
}

function Test-DataDirHasContent {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [bool](
        (Test-Path -LiteralPath (Join-Path $Path "signage.sqlite") -PathType Leaf) -or
        (Test-Path -LiteralPath (Join-Path $Path ".env") -PathType Leaf) -or
        (Test-Path -LiteralPath (Join-Path $Path "uploads") -PathType Container)
    )
}

function Resolve-InstallerDataDir {
    param(
        [Parameter(Mandatory = $true)][string]$InstallDir,
        [Parameter(Mandatory = $true)][string]$DefaultDataDir
    )
    $normalizedInstall = Get-NormalizedPath -Path $InstallDir
    $normalizedDefault = Get-NormalizedPath -Path $DefaultDataDir
    $toDataDirPath = {
        param([string]$Value, [string]$Source)
        $candidate = [Environment]::ExpandEnvironmentVariables($Value.Trim())
        if (-not [IO.Path]::IsPathRooted($candidate)) {
            $candidate = Join-Path $normalizedInstall $candidate
        }
        try {
            $candidate = Get-NormalizedPath -Path $candidate
            Assert-DataDirOutsideInstall -InstallDir $normalizedInstall -DataDir $candidate
        } catch {
            throw "데이터 경로 후보($Source)가 유효하지 않습니다: $Value. $($_.Exception.Message)"
        }
        return $candidate
    }

    $configPath = Join-Path $normalizedInstall "install.json"
    $hasManifest = Test-Path -LiteralPath $configPath -PathType Leaf
    $configuredDataDir = ""
    if ($hasManifest) {
        try {
            $config = Read-JsonFile -Path $configPath
        } catch {
            throw "기존 install.json을 읽지 못해 데이터 경로를 확인할 수 없습니다. 기존 데이터 보존을 위해 중단합니다: $($_.Exception.Message)"
        }
        $configuredValue = [string]$config.dataDir
        if (-not [string]::IsNullOrWhiteSpace($configuredValue)) {
            $configuredDataDir = & $toDataDirPath $configuredValue "install.json"
        }
    }

    $legacyEnvPath = Join-Path $normalizedInstall ".env"
    $hasLegacyEnv = Test-Path -LiteralPath $legacyEnvPath -PathType Leaf
    $legacyDataDir = ""
    if ($hasLegacyEnv) {
        $legacyValue = Get-EnvValue -EnvFile $legacyEnvPath -Name "DATA_DIR"
        if (-not [string]::IsNullOrWhiteSpace($legacyValue)) {
            $legacyDataDir = & $toDataDirPath $legacyValue "InstallDir\.env"
        }
    }

    if ($configuredDataDir -and $legacyDataDir -and
        -not (Test-PathEqual -Left $configuredDataDir -Right $legacyDataDir)) {
        throw "install.json과 InstallDir\.env의 DATA_DIR가 서로 달라 데이터를 변경하지 않고 업그레이드를 중단했습니다. install.json=$configuredDataDir, .env=$legacyDataDir"
    }

    if ($configuredDataDir) {
        if (-not (Test-Path -LiteralPath $configuredDataDir -PathType Container)) {
            throw "install.json에 기록된 데이터 폴더를 찾지 못했습니다. 새 빈 데이터베이스를 만들지 않도록 중단합니다: $configuredDataDir"
        }
        return [pscustomobject]@{
            DataDir = $configuredDataDir
            Source = "install.json"
            HasPreviousEvidence = $true
            HasExistingData = (Test-DataDirHasContent -Path $configuredDataDir)
        }
    }

    if ($legacyDataDir) {
        if (-not (Test-Path -LiteralPath $legacyDataDir -PathType Container)) {
            throw "InstallDir\.env의 DATA_DIR 폴더를 찾지 못했습니다. 새 빈 데이터베이스를 만들지 않도록 중단합니다: $legacyDataDir"
        }
        return [pscustomobject]@{
            DataDir = $legacyDataDir
            Source = "install-env"
            HasPreviousEvidence = $true
            HasExistingData = (Test-DataDirHasContent -Path $legacyDataDir)
        }
    }

    if ($hasManifest -or $hasLegacyEnv) {
        throw "기존 설치 흔적은 있지만 데이터 경로를 확인할 수 없습니다. 새 빈 데이터베이스나 샘플을 만들지 않도록 중단합니다. install.json=$configPath, .env=$legacyEnvPath"
    }

    $defaultExists = Test-Path -LiteralPath $normalizedDefault -PathType Container
    return [pscustomobject]@{
        DataDir = $normalizedDefault
        Source = $(if ($defaultExists) { "default" } else { "default-new" })
        HasPreviousEvidence = $false
        HasExistingData = [bool]($defaultExists -and (Test-DataDirHasContent -Path $normalizedDefault))
    }
}

function Get-DataDirArgumentValues {
    param([AllowEmptyString()][string]$Arguments)
    if ([string]::IsNullOrWhiteSpace($Arguments)) { return @() }
    $tokens = [Collections.Generic.List[string]]::new()
    $builder = [Text.StringBuilder]::new()
    $inDouble = $false
    $inSingle = $false
    for ($index = 0; $index -lt $Arguments.Length; $index++) {
        $character = $Arguments[$index]
        if ($character -eq [char]92 -and $inDouble -and ($index + 1) -lt $Arguments.Length -and
            $Arguments[$index + 1] -eq [char]34) {
            [void]$builder.Append([char]34)
            $index++
            continue
        }
        if ($character -eq [char]34 -and -not $inSingle) {
            $inDouble = -not $inDouble
            continue
        }
        if ($character -eq [char]39 -and -not $inDouble) {
            $inSingle = -not $inSingle
            continue
        }
        if ([char]::IsWhiteSpace($character) -and -not $inDouble -and -not $inSingle) {
            if ($builder.Length -gt 0) {
                $tokens.Add($builder.ToString())
                [void]$builder.Clear()
            }
            continue
        }
        [void]$builder.Append($character)
    }
    if ($builder.Length -gt 0) { $tokens.Add($builder.ToString()) }

    $values = [Collections.Generic.List[string]]::new()
    for ($index = 0; $index -lt $tokens.Count; $index++) {
        $match = [regex]::Match($tokens[$index], '^(?:-{1,2}data-?dir|/DATADIR)(?:=(.*))?$',
            [Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if (-not $match.Success) { continue }
        $value = $match.Groups[1].Value
        if (-not $value) {
            if (($index + 1) -lt $tokens.Count) {
                $value = $tokens[$index + 1]
                $index++
            } else {
                continue
            }
        }
        $value = ConvertFrom-EnvScalarValue -Value $value
        if (-not [string]::IsNullOrWhiteSpace($value)) { $values.Add($value) }
    }
    return @($values | Select-Object -Unique)
}
