[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$HookPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $HookPath)) {
    throw "Admission hook not found: $HookPath"
}

$fixtureDirectory = Join-Path $env:TEMP ("gugak-runner-admission-tests-{0}" -f [guid]::NewGuid())
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$repository = 'toxicyou25-afk/GugakSignage'

function Invoke-AdmissionCase {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$EventName,
        [Parameter(Mandatory = $true)][string]$EventRepository,
        [AllowNull()][string]$HeadRepository,
        [Parameter(Mandatory = $true)][int]$ExpectedExitCode
    )

    $event = [ordered]@{
        repository = [ordered]@{ full_name = $EventRepository }
    }
    if ($EventName -eq 'pull_request') {
        $event.pull_request = [ordered]@{
            head = [ordered]@{ repo = [ordered]@{ full_name = $HeadRepository } }
            base = [ordered]@{ repo = [ordered]@{ full_name = $EventRepository } }
        }
    }

    $eventPath = Join-Path $fixtureDirectory "$Name.json"
    $stdoutPath = Join-Path $fixtureDirectory "$Name.stdout.txt"
    $stderrPath = Join-Path $fixtureDirectory "$Name.stderr.txt"
    $event | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $eventPath -Encoding UTF8
    $env:GITHUB_EVENT_PATH = $eventPath
    $env:GITHUB_EVENT_NAME = $EventName
    $env:GITHUB_REPOSITORY = $repository
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$HookPath`"")
    $child = Start-Process -FilePath $powershell -ArgumentList $arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $actualExitCode = $child.ExitCode
    if ($actualExitCode -ne $ExpectedExitCode) {
        throw "Admission case '$Name' returned $actualExitCode; expected $ExpectedExitCode."
    }
}

New-Item -ItemType Directory -Path $fixtureDirectory -Force | Out-Null
try {
    Invoke-AdmissionCase -Name 'same-repository-pr' -EventName 'pull_request' -EventRepository $repository -HeadRepository $repository -ExpectedExitCode 0
    Invoke-AdmissionCase -Name 'fork-pr' -EventName 'pull_request' -EventRepository $repository -HeadRepository 'outside-user/GugakSignage' -ExpectedExitCode 1
    Invoke-AdmissionCase -Name 'trusted-push' -EventName 'push' -EventRepository $repository -HeadRepository $null -ExpectedExitCode 0
    Invoke-AdmissionCase -Name 'workflow-dispatch' -EventName 'workflow_dispatch' -EventRepository $repository -HeadRepository $null -ExpectedExitCode 1
    Invoke-AdmissionCase -Name 'unexpected-repository' -EventName 'pull_request' -EventRepository 'outside-user/GugakSignage' -HeadRepository 'outside-user/GugakSignage' -ExpectedExitCode 1
}
finally {
    Remove-Item -LiteralPath $fixtureDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output 'PASS: runner admission allows same-repository PR and push, and denies fork PR, workflow_dispatch, and unexpected repositories.'
