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

function Test-PathEqual {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )
    $leftPath = Get-NormalizedPath -Path $Left
    $rightPath = Get-NormalizedPath -Path $Right
    return $leftPath.Equals($rightPath, [StringComparison]::OrdinalIgnoreCase)
}

function Test-PathWithin {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Parent
    )
    $childPath = Get-NormalizedPath -Path $Path
    $parentPath = Get-NormalizedPath -Path $Parent
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
        (Test-PathWithin -Path $normalizedData -Parent $normalizedInstall)) {
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
        ([Environment]::GetFolderPath("MyDocuments")),
        ([Environment]::GetFolderPath("MyPictures")),
        ([Environment]::GetFolderPath("MyVideos"))
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

function Get-VerifiedOwnedProcess {
    param(
        [int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
        [string]$ExpectedStartTime = "",
        [string[]]$CommandLineContains = @()
    )
    if ($ProcessId -le 0) { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $process -or -not $process.ExecutablePath) { return $null }
    if (-not (Test-PathEqual -Left ([string]$process.ExecutablePath) -Right $ExpectedExecutable)) { return $null }
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
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $process) { return $false }
    $verified = Get-VerifiedOwnedProcess -ProcessId $ProcessId -ExpectedExecutable $ExpectedExecutable -ExpectedStartTime $ExpectedStartTime -CommandLineContains $CommandLineContains
    if (-not $verified) {
        throw "프로세스 소유권을 확인하지 못해 종료하지 않았습니다. PID=$ProcessId"
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

function Get-EnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$EnvFile,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if (-not (Test-Path -LiteralPath $EnvFile)) { return "" }
    $pattern = "(?m)^\s*" + [regex]::Escape($Name) + "\s*=\s*(?:""([^""]*)""|'([^']*)'|([^\r\n#]*))"
    $match = [regex]::Match((Get-Content -LiteralPath $EnvFile -Raw), $pattern)
    if (-not $match.Success) { return "" }
    if ($match.Groups[1].Success) { return $match.Groups[1].Value.Trim() }
    if ($match.Groups[2].Success) { return $match.Groups[2].Value.Trim() }
    return $match.Groups[3].Value.Trim()
}
