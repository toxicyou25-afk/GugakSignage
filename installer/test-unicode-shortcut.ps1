# SPDX-License-Identifier: Apache-2.0
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "ops\install-common.ps1")

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = Join-Path $tempBase ("GugakSignage-UnicodeShortcut-" + [guid]::NewGuid().ToString("N"))
$shortcutName = [string]::Concat([char]0xC5F4, [char]0xB9B0, [char]0xC548, [char]0xB0B4, [char]0xD310, ".lnk")
$shortcutPath = Join-Path $testRoot $shortcutName
$targetPath = Join-Path $env:SystemRoot "System32\notepad.exe"
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

try {
    Save-WindowsShortcut -ShortcutPath $shortcutPath -TargetPath $targetPath -Arguments "--unicode-shortcut-test" -WorkingDirectory $testRoot -Description "Unicode shortcut test"
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw "Unicode shortcut was not created: $shortcutPath" }
    $savedTarget = [GugakShortcutNative]::GetTargetPath($shortcutPath)
    $savedArguments = [GugakShortcutNative]::GetArguments($shortcutPath)
    if ($savedTarget -ne $targetPath) { throw "Unicode shortcut target differs: $savedTarget" }
    if ($savedArguments -ne "--unicode-shortcut-test") { throw "Unicode shortcut arguments differ: $savedArguments" }
    [pscustomobject]@{ result = "passed"; unicodeShortcutName = $shortcutName; targetPreserved = $true } | ConvertTo-Json -Compress
} finally {
    $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
    if ($resolvedRoot.StartsWith($tempBase.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolvedRoot).StartsWith("GugakSignage-UnicodeShortcut-", [StringComparison]::Ordinal)) {
        Remove-Item -LiteralPath $resolvedRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
