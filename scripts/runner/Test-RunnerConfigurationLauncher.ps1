[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$LauncherPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$probeDirectory = Join-Path $env:TEMP ("gugak-runner-token-probe-{0}" -f [guid]::NewGuid())
$probeScript = Join-Path $probeDirectory 'Read-ConsoleSecret.ps1'
$probeResult = Join-Path $probeDirectory 'command-line.txt'
$probeToken = "probe-token-{0}" -f [guid]::NewGuid()
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$oldProbeResult = $env:GUGAK_RUNNER_TOKEN_PROBE_RESULT

try {
    New-Item -ItemType Directory -Path $probeDirectory -Force | Out-Null
    $probeLines = @(
        '$commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").CommandLine',
        '[IO.File]::WriteAllText($env:GUGAK_RUNNER_TOKEN_PROBE_RESULT, $commandLine, [Text.UTF8Encoding]::new($false))',
        '$key = [Console]::ReadKey($true)',
        'if ($key.KeyChar -eq [char]112) { exit 0 } else { exit 9 }'
    )
    [IO.File]::WriteAllText($probeScript, ($probeLines -join "`r`n"), [Text.UTF8Encoding]::new($false))

    $payload = [ordered]@{
        executable = $powershell
        arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $probeScript)
        workingDirectory = $probeDirectory
    }
    $payloadJson = $payload | ConvertTo-Json -Compress -Depth 4
    $payloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payloadJson))
    $env:GUGAK_RUNNER_TOKEN_PROBE_RESULT = $probeResult

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $powershell
    $startInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$LauncherPath`" -PayloadBase64 $payloadBase64"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $null = $process.Start()
    $process.StandardInput.WriteLine($probeToken)
    $process.StandardInput.Close()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(300000)) {
        $process.Kill()
        throw 'Runner configuration launcher probe timed out.'
    }
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    if ($process.ExitCode -ne 0) {
        throw "Runner configuration launcher probe failed with exit $($process.ExitCode): $stderr"
    }
    if (-not (Test-Path -LiteralPath $probeResult)) {
        throw 'The console probe did not record its process command line.'
    }
    $childCommandLine = Get-Content -LiteralPath $probeResult -Raw
    if ($childCommandLine.Contains($probeToken)) {
        throw 'Registration-token probe detected the token in the child process command line.'
    }
    Write-Output 'PASS: runner configuration token was accepted through console input and did not appear in child process argv.'
}
finally {
    if ($null -eq $oldProbeResult) {
        Remove-Item Env:\GUGAK_RUNNER_TOKEN_PROBE_RESULT -ErrorAction SilentlyContinue
    } else {
        $env:GUGAK_RUNNER_TOKEN_PROBE_RESULT = $oldProbeResult
    }
    Remove-Item -LiteralPath $probeDirectory -Recurse -Force -ErrorAction SilentlyContinue
    $probeToken = $null
    [GC]::Collect()
}
